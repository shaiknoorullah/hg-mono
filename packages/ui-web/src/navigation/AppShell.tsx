import { useEffect, useRef, type ReactNode } from 'react';

import { cx, type Density } from '../feedback/internal.js';

/**
 * `AppShell` — the frame every operational web screen (restaurant, admin) sits inside.
 *
 * What it is responsible for, and nothing else:
 *
 *  - **Skip links.** "A skip link ('Skip to main content') is the first focusable element
 *    on every web page. Admin adds 'Skip to table'." (a11y §4.3.) They are real anchors,
 *    visible on focus.
 *  - **Landmarks.** One `banner`, one `navigation`, one `main`, one optional
 *    `complementary`. `main` is programmatically focusable so the skip link lands.
 *  - **Route focus.** "Route changes move focus to the new page's `h1` and announce the
 *    page name" (a11y §4.2). Driven by `routeKey`, which changes when the route does.
 *  - **A system banner slot** above the content — the restaurant queue's SSE-disconnect
 *    banner is the highest-severity UI state on that surface and must sit above
 *    everything, not inside a scroll container.
 *
 * It deliberately does **not** hide chrome on scroll. Per §27: "Never a scroll-hidden
 * AppBar on the rider or restaurant surfaces — an operational chrome that disappears is a
 * control that cannot be found in a hurry." There is no prop for it.
 */

export interface SkipTarget {
  /** The `id` of the element to skip to. It must be focusable (`tabIndex={-1}`). */
  id: string;
  label: string;
}

export interface AppShellProps {
  /** Rendered inside `<header role="banner">`. Usually a `TopBar`. */
  topBar?: ReactNode;
  /** Rendered inside `<nav>`. Usually a `SideNav`. */
  sideNav?: ReactNode;
  /** System-level banners. Above the scroll region, always visible. */
  systemBanner?: ReactNode;
  /** Breadcrumbs / filter bar / page heading — anything sticky above the content. */
  pageHeader?: ReactNode;
  children: ReactNode;
  /** A side sheet region (admin row detail). `role="complementary"`. */
  aside?: ReactNode;
  /** Changes when the route changes. Drives focus movement and the announcement. */
  routeKey?: string;
  /** Announced on route change. Usually the page title. */
  routeAnnouncement?: string;
  /**
   * Extra skip targets. "Skip to main content" is always first; admin passes
   * `[{ id: 'orders-table', label: 'Skip to table' }]`.
   */
  skipTargets?: readonly SkipTarget[];
  /** `operational` surfaces run `compact`; the token drives row heights downstream. */
  density?: Density;
  mainId?: string;
  className?: string;
  testId?: string;
}

const MAIN_ID_DEFAULT = 'hg-main';

export function AppShell({
  topBar,
  sideNav,
  systemBanner,
  pageHeader,
  children,
  aside,
  routeKey,
  routeAnnouncement,
  skipTargets = [],
  density = 'compact',
  mainId = MAIN_ID_DEFAULT,
  className,
  testId = 'app-shell',
}: AppShellProps): ReactNode {
  const mainRef = useRef<HTMLElement | null>(null);
  const liveRef = useRef<HTMLParagraphElement | null>(null);
  const firstRenderRef = useRef(true);

  useEffect(() => {
    if (firstRenderRef.current) {
      // Do not steal focus on the initial mount — only on an actual route change.
      firstRenderRef.current = false;
      return;
    }
    const heading = mainRef.current?.querySelector<HTMLElement>('h1');
    (heading ?? mainRef.current)?.focus();
    if (liveRef.current && routeAnnouncement) liveRef.current.textContent = routeAnnouncement;
  }, [routeKey, routeAnnouncement]);

  const targets: readonly SkipTarget[] = [
    { id: mainId, label: 'Skip to main content' },
    ...skipTargets,
  ];

  return (
    <div
      data-testid={testId}
      data-density={density}
      className={cx('flex min-h-dvh flex-col bg-surface-sunken text-fg-primary', className)}
    >
      {/* First focusable elements on the page, visible only when focused. */}
      <div className="sr-only focus-within:not-sr-only focus-within:absolute focus-within:z-[var(--hg-z-sticky)] focus-within:flex focus-within:gap-2 focus-within:bg-surface-base focus-within:p-2">
        {targets.map((target) => (
          <a
            key={target.id}
            href={`#${target.id}`}
            data-testid={`skip-link-${target.id}`}
            className={cx(
              'inline-flex h-11 items-center rounded-md border border-line-interactive px-4',
              'text-label-lg font-semibold text-fg-primary',
              'hg-focus',
            )}
          >
            {target.label}
          </a>
        ))}
      </div>

      {topBar ? <header role="banner">{topBar}</header> : null}

      {systemBanner ? (
        <div data-testid="app-shell-system-banner" className="px-4 pt-3">
          {systemBanner}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-row">
        {sideNav ? <nav aria-label="Main">{sideNav}</nav> : null}

        <div className="flex min-w-0 flex-1 flex-col">
          {pageHeader ? (
            <div className="sticky top-0 z-[var(--hg-z-sticky)] border-b border-line-decorative bg-surface-base">
              {pageHeader}
            </div>
          ) : null}

          <main
            id={mainId}
            ref={mainRef}
            tabIndex={-1}
            className="min-w-0 flex-1 hg-focus"
          >
            {children}
          </main>
        </div>

        {aside ? (
          <aside role="complementary" aria-label="Details" className="shrink-0">
            {aside}
          </aside>
        ) : null}
      </div>

      {/* Route announcements. Polite: a route change is not an interruption. */}
      <p ref={liveRef} aria-live="polite" className="sr-only" />
    </div>
  );
}
