/**
 * The signed-in console's layout route (manifest §1.1, §2.8; boards `ASS/AdminSidebar`,
 * `ASS/SystemBannerStack`, `RV/Shell-Forbidden`, `ORD/AdminNavCollapsed`,
 * `ORD/AdminNavCountsPending`, `STF/SkipLinkFocus`).
 *
 *   [skip link] [SideNav 264px | 80px rail] [ banner slot ]
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

import { Banner, Button, Icon, NavDrawer, SideNav, SideNavIconSlot, Wordmark } from '../ds';
import { api } from '../data/api';
import { getSession, staffRoleOf, subscribeSession, type StaffRole } from '../data/session';
import { queueCountsNote, useQueueDepth } from '../realtime/queueDepth';
import { useSystemBanners } from '../system/banners';
import { FORBIDDEN, NOT_FOUND } from './copy';
import { useLanding } from './landing';
import { navGroupsFor, ROLE_LABEL } from './nav';
import { PageTitleContext } from './pageTitle';
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
 * Below 1280 CSS px the nav starts as the 80px rail (boards `RO/QueueNarrow1024`,
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

/** The What's new panel's id (WP-10), for the footer button's `aria-controls`. */
const WHATS_NEW_PANEL_ID = 'admin-whats-new-panel';
const WHATS_NEW_UNAVAILABLE = 'What’s new comes in a later update.';

const CHROME_ITEM =
  'hg-focus [--hg-focus-ring-offset:var(--hg-surface-chrome)] [--hg-focus-ring-color:var(--hg-text-on-accent)] flex min-h-11 items-center rounded-md text-fg-on-accent no-underline';

/** The sidebar footer: count status, System status, who is signed in, Sign out. */
function NavFooter({
  collapsed,
  role,
  systemHref,
  systemCurrent,
  onSystem,
  onSignOut,
  signingOut,
  countsNote,
}: {
  collapsed: boolean;
  role: StaffRole | null;
  systemHref: string;
  systemCurrent: boolean;
  onSystem: (event: MouseEvent<HTMLAnchorElement>) => void;
  onSignOut: () => void;
  signingOut: boolean;
  countsNote: string | null;
}) {
  const roleLabel = role ? ROLE_LABEL[role] : '';
  return (
    <div className={collapsed ? 'flex w-full flex-col items-center gap-1' : 'flex w-full flex-col gap-1'}>
      {countsNote ? (
        <p data-testid="queue-counts-note" className={collapsed ? 'sr-only' : 'px-2 pb-1 text-body-sm text-fg-on-accent'}>
          {countsNote}
        </p>
      ) : null}
      {/*
        What's new, as `ASS/AdminSidebar` draws it. Its panel is WP-10, so the button is drawn but
        unavailable: aria-disabled (still focusable, so the reason can be heard), collapsed, and
        pointing at the (empty, hidden) panel region it will open.
      */}
      <button
        type="button"
        aria-disabled="true"
        aria-expanded={false}
        aria-controls={WHATS_NEW_PANEL_ID}
        aria-label={collapsed ? 'What’s new' : undefined}
        aria-describedby={`${WHATS_NEW_PANEL_ID}-reason`}
        title={WHATS_NEW_UNAVAILABLE}
        onClick={(event) => event.preventDefault()}
        className={`${CHROME_ITEM} cursor-not-allowed border-0 bg-transparent opacity-70 ${
          collapsed ? 'min-h-12 w-full flex-col justify-center gap-0.5 px-0.5 py-1 text-caption' : 'w-full gap-3 px-3 py-2 text-body-md'
        }`}
      >
        <SideNavIconSlot />
        <span aria-hidden={collapsed ? 'true' : undefined} className={collapsed ? 'max-w-[72px] text-center leading-tight' : undefined}>
          What’s new
        </span>
      </button>
      <span id={`${WHATS_NEW_PANEL_ID}-reason`} className="sr-only">
        {WHATS_NEW_UNAVAILABLE}
      </span>
      <div id={WHATS_NEW_PANEL_ID} hidden />
      <a
        href={systemHref}
        aria-current={systemCurrent ? 'page' : undefined}
        aria-label={collapsed ? 'System status' : undefined}
        onClick={onSystem}
        className={`${CHROME_ITEM} ${collapsed ? 'min-h-12 w-full flex-col justify-center gap-0.5 px-0.5 py-1 text-caption' : 'gap-3 px-3 py-2 text-body-md'} ${
          systemCurrent ? 'bg-fg-on-accent font-semibold text-surface-chrome' : 'hover:bg-[var(--hg-state-hover-overlay)]'
        }`}
      >
        <SideNavIconSlot />
        <span aria-hidden={collapsed ? 'true' : undefined}>{collapsed ? 'System' : 'System status'}</span>
      </a>
      {!collapsed && role ? (
        <p className="px-3 pt-1 text-body-sm text-fg-on-accent">
          Signed in as <strong className="font-bold">{roleLabel}</strong>
        </p>
      ) : null}
      <button
        type="button"
        onClick={onSignOut}
        disabled={signingOut}
        aria-label={collapsed && role ? `Sign out, signed in as ${roleLabel}` : undefined}
        className={`${CHROME_ITEM} justify-center border border-current font-semibold disabled:opacity-70 ${
          collapsed ? 'w-full px-1 text-label-sm' : 'mt-1 w-full px-3 text-body-md'
        }`}
      >
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}

/**
 * 403 (`RV/Shell-Forbidden`): plain content, not an alert. The shell moves focus to the app bar
 * heading "No permission". Copy verbatim from the board, with the role and the permission filled
 * in; "Back to …" is outlined (tertiary), as the board draws it.
 */
function Forbidden({ role, permission }: { role: StaffRole | null; permission: string | undefined }) {
  const back = useLanding();
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

export function AdminShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const session = useSyncExternalStore(subscribeSession, getSession, getSession);
  const role = staffRoleOf(session.principal);
  const queue = useQueueDepth();
  const banners = useSystemBanners();
  const narrow = useMediaQuery(NARROW_QUERY, NARROW_MAX_PX);
  // No fallback without matchMedia: an unknown width keeps the nav open.
  const compact = useMediaQuery(COMPACT_QUERY, null);
  const base = useHref('/');
  const href = useCallback((path: string) => `${base.replace(/\/$/, '')}${path}`, [base]);

  const route = findAdminRoute(pathname);
  const forbidden = route !== null && !canOpen(route, role);
  const notFound = route === null && pathname !== '/' && !pathname.startsWith('/applications/');

  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const heading = forbidden ? FORBIDDEN.heading : notFound ? NOT_FOUND.heading : (titleOverride ?? route?.title ?? '');

  // The rail on detail workspaces; elsewhere whatever the person last chose on a list page.
  const detail = Boolean(route?.detail) && !forbidden;
  // `null` until the person chooses on a list page: the window's width decides until then.
  const [preferCollapsed, setPreferCollapsed] = useState<boolean | null>(null);
  const [manual, setManual] = useState<{ path: string; collapsed: boolean } | null>(null);
  const collapsed = manual && manual.path === pathname ? manual.collapsed : detail || (preferCollapsed ?? compact);
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

  const footer = (rail: boolean) => (
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
    />
  );

  const header = (
    <div className="flex flex-col items-start gap-1 py-1">
      <Wordmark tone="chrome" height={28} />
      <span className="text-body-sm text-fg-on-accent">Operations · Ontario</span>
    </div>
  );

  return (
    <PageTitleContext.Provider value={setTitleOverride}>
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
                  />
                </section>
              ))}
            </div>
          ) : null}

          <main
            ref={mainRef}
            id="main-content"
            tabIndex={-1}
            aria-labelledby="app-bar-heading"
            className="flex min-h-0 flex-1 flex-col outline-none"
          >
            <div ref={appBarRef} className="flex min-h-14 shrink-0 items-center gap-3 border-b border-line-decorative bg-surface-raised px-4">
              {narrow ? (
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
              <h1 ref={headingRef} id="app-bar-heading" tabIndex={-1} className="text-heading-md text-fg-primary outline-none">
                {heading}
              </h1>
            </div>
            {forbidden ? <Forbidden role={role} permission={route?.permission} /> : <Outlet />}
          </main>
        </div>

        {narrow ? (
          <NavDrawer id={NAV_DRAWER_ID} open={drawerOpen} onClose={() => setDrawerOpen(false)}>
            <SideNav
              id="admin-nav-drawer"
              label="Admin"
              groups={groups}
              collapsed={false}
              header={header}
              footer={footer(false)}
              onNavigate={(target) => {
                setDrawerOpen(false);
                onNavigate(target);
              }}
            />
          </NavDrawer>
        ) : null}
      </div>
    </PageTitleContext.Provider>
  );
}
