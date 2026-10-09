/**
 * The signed-in route table (manifest §1.2) as data, and the `<Routes>` built from it.
 *
 * Every route renders, in order of preference:
 *   1. its redesigned screen from `./redesigned.ts` (each work package adds one line there);
 *   2. the legacy screen from `src/screens/*`, inside the new shell, until then;
 *   3. a "Not built yet" section naming the work package that builds it.
 *
 * Role gating (§1.1) lives in the table: a route the viewer's role may not open renders the
 * 403 "No permission" page (`RV/Shell-Forbidden`), drawn by the shell. Unknown paths render the
 * not-found page. `/` sends each role to its landing page.
 */
import { Suspense, lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { Navigate, Route, Routes, matchPath, useParams } from 'react-router-dom';

import { Skeleton } from '../ds';
import type { StaffRole } from '../data/session';
import { AdminShell } from './AdminShell';
import { landingPath, type NavKey } from './nav';
import { NOT_BUILT } from './copy';
import { CertificatesEntryPage, NotFoundPage } from './pages';
import { REDESIGNED } from './redesigned';

export type RouteId =
  | 'certificates'
  | 'certificate'
  | 'certificateViewer'
  | 'restaurants'
  | 'restaurant'
  | 'menuItem'
  | 'riders'
  | 'rider'
  | 'issuingBodies'
  | 'menuReviews'
  | 'menuReview'
  | 'orders'
  | 'disputes'
  | 'order'
  | 'refunds'
  | 'alerts'
  | 'alert'
  | 'staff'
  | 'staffMember'
  | 'account'
  | 'system';

export interface AdminRoute {
  readonly id: RouteId;
  /** react-router path, relative to the console root. */
  readonly path: string;
  /** The app bar heading. */
  readonly title: string;
  /** Roles that may open it; anyone else gets "No permission". */
  readonly roles: readonly StaffRole[];
  /** The sidebar item that is current on this route (`system` is the footer link). */
  readonly nav: NavKey | 'system' | null;
  /** A detail workspace: the sidebar folds to the rail on arrival. */
  readonly detail: boolean;
  /** The work package that redesigns it. */
  readonly wp: string;
  /** For the 403 copy: "doesn't include the permission this page needs: menu review." */
  readonly permission?: string;
}

const ALL: readonly StaffRole[] = ['SUPPORT_AGENT', 'ADMIN', 'SUPER_ADMIN'];
const ADMINS: readonly StaffRole[] = ['ADMIN', 'SUPER_ADMIN'];

/**
 * §1.2, most specific first. Detail workspaces (an id in the path that opens a workspace) fold the
 * nav to the rail; list pages whose id only opens an in-page panel (`/alerts/:seq`,
 * `/staff/:staffId`) keep it open.
 */
export const ADMIN_ROUTES: readonly AdminRoute[] = [
  { id: 'certificateViewer', path: '/certificates/:certificateId/viewer', title: 'Certificate', roles: ALL, nav: 'certificates', detail: true, wp: 'WP-3' },
  { id: 'certificate', path: '/certificates/:certificateId', title: 'Halal verification', roles: ALL, nav: 'certificates', detail: true, wp: 'WP-3' },
  { id: 'certificates', path: '/certificates', title: 'Halal certificates', roles: ALL, nav: 'certificates', detail: false, wp: 'WP-3' },
  { id: 'menuItem', path: '/restaurants/:restaurantId/menu/items/:itemId', title: 'Menu item', roles: ADMINS, nav: 'menuReviews', detail: true, wp: 'WP-4', permission: 'menu review' },
  { id: 'restaurant', path: '/restaurants/:restaurantId', title: 'Restaurant application', roles: ALL, nav: 'restaurants', detail: true, wp: 'WP-2' },
  { id: 'restaurants', path: '/restaurants', title: 'Restaurant applications', roles: ALL, nav: 'restaurants', detail: false, wp: 'WP-2' },
  { id: 'rider', path: '/riders/:riderAccountId', title: 'Rider application', roles: ADMINS, nav: 'riders', detail: true, wp: 'WP-5', permission: 'rider review' },
  { id: 'riders', path: '/riders', title: 'Rider applications', roles: ADMINS, nav: 'riders', detail: false, wp: 'WP-5', permission: 'rider review' },
  { id: 'issuingBodies', path: '/issuing-bodies', title: 'Issuing bodies', roles: ALL, nav: 'issuingBodies', detail: false, wp: 'WP-4' },
  { id: 'menuReview', path: '/menu-reviews/:versionId', title: 'Menu reviews', roles: ADMINS, nav: 'menuReviews', detail: true, wp: 'WP-4', permission: 'menu review' },
  { id: 'menuReviews', path: '/menu-reviews', title: 'Menu reviews', roles: ADMINS, nav: 'menuReviews', detail: false, wp: 'WP-4', permission: 'menu review' },
  { id: 'order', path: '/orders/:orderId', title: 'Order', roles: ALL, nav: 'orders', detail: true, wp: 'WP-7' },
  { id: 'orders', path: '/orders', title: 'Orders', roles: ALL, nav: 'orders', detail: false, wp: 'WP-6' },
  { id: 'disputes', path: '/disputes', title: 'Disputes', roles: ALL, nav: 'refunds', detail: false, wp: 'WP-6' },
  { id: 'refunds', path: '/refunds', title: 'Refunds & disputes', roles: ALL, nav: 'refunds', detail: false, wp: 'WP-8' },
  { id: 'alert', path: '/alerts/:seq', title: 'Live alerts', roles: ALL, nav: 'alerts', detail: false, wp: 'WP-9' },
  { id: 'alerts', path: '/alerts', title: 'Live alerts', roles: ALL, nav: 'alerts', detail: false, wp: 'WP-9' },
  { id: 'staffMember', path: '/staff/:staffId', title: 'Staff', roles: ADMINS, nav: 'staff', detail: false, wp: 'WP-11', permission: 'staff accounts' },
  { id: 'staff', path: '/staff', title: 'Staff', roles: ADMINS, nav: 'staff', detail: false, wp: 'WP-11', permission: 'staff accounts' },
  { id: 'account', path: '/account', title: 'Your account', roles: ALL, nav: 'account', detail: false, wp: 'WP-10' },
  { id: 'system', path: '/system', title: 'System status', roles: ALL, nav: 'system', detail: false, wp: 'WP-10' },
];

/** The table entry for a pathname, or `null` (the not-found page). */
export function findAdminRoute(pathname: string): AdminRoute | null {
  for (const route of ADMIN_ROUTES) {
    if (matchPath({ path: route.path, end: true }, pathname)) return route;
  }
  return null;
}

export function canOpen(route: AdminRoute, role: StaffRole | null): boolean {
  return role !== null && route.roles.includes(role);
}

type Screen = ComponentType | LazyExoticComponent<ComponentType>;

function legacy<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K): Screen {
  return lazy(() => load().then((mod) => ({ default: mod[name] })));
}

/** Legacy screens shown inside the new shell until their WP lands. */
const LEGACY: Partial<Record<RouteId, Screen>> = {
  restaurants: legacy(() => import('../../screens/OnboardingQueueScreen'), 'OnboardingQueueScreen'),
  restaurant: legacy(() => import('../../screens/ApplicationDetailScreen'), 'ApplicationDetailScreen'),
  certificate: legacy(() => import('../../screens/HalalVerificationScreen'), 'HalalVerificationScreen'),
  riders: legacy(() => import('../../screens/RiderQueueScreen'), 'RiderQueueScreen'),
  rider: legacy(() => import('../../screens/RiderApplicationDetailScreen'), 'RiderApplicationDetailScreen'),
  orders: legacy(() => import('../../screens/OrdersAdminScreen'), 'OrdersAdminScreen'),
  order: legacy(() => import('../../screens/OrderDetailScreen'), 'OrderDetailScreen'),
  refunds: legacy(() => import('../../screens/RefundCasesScreen'), 'RefundCasesScreen'),
  staff: legacy(() => import('../../screens/StaffListScreen'), 'StaffListScreen'),
  system: legacy(() => import('../../screens/DependencyDashboardScreen'), 'DependencyDashboardScreen'),
};

/** Pages the shell itself builds (WP-1). */
const SHELL_PAGES: Partial<Record<RouteId, Screen>> = {
  certificates: CertificatesEntryPage,
};

function Loading() {
  return (
    <div className="p-6">
      <Skeleton variant="lines" count={4} label="Loading the page" />
    </div>
  );
}

/** A route whose redesigned screen has not landed and that has no legacy screen. */
function NotBuilt({ title, wp }: { title: string; wp: string }) {
  return (
    <section aria-labelledby="not-built-heading" className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
      <div role="status" className="w-full max-w-[552px] rounded-lg border border-line-decorative bg-surface-raised px-6 py-10 text-center">
        <h2 id="not-built-heading" className="text-heading-sm text-fg-primary">
          {NOT_BUILT.title}
        </h2>
        <p className="mt-2 text-body-md text-fg-secondary">{NOT_BUILT.body(title, wp)}</p>
      </div>
    </section>
  );
}

function RouteElement({ route }: { route: AdminRoute }) {
  const Redesigned = REDESIGNED[route.id];
  if (Redesigned) {
    return (
      <Suspense fallback={<Loading />}>
        <Redesigned />
      </Suspense>
    );
  }
  const Shell = SHELL_PAGES[route.id];
  if (Shell) return <Shell />;
  const Legacy = LEGACY[route.id];
  if (Legacy) {
    // The legacy screens bring their own heading and padding; they scroll inside main.
    return (
      <div data-legacy-screen={route.id} className="adm-main min-h-0 flex-1 overflow-auto p-6">
        <Suspense fallback={<Loading />}>
          <Legacy />
        </Suspense>
      </div>
    );
  }
  return <NotBuilt title={route.title} wp={route.wp} />;
}

/** Legacy screens still link to `/applications/:id`; send them to the new path. */
function LegacyApplicationRedirect() {
  const { restaurantId = '' } = useParams();
  return <Navigate to={`/restaurants/${restaurantId}`} replace />;
}

function Landing({ role }: { role: StaffRole | null }) {
  return <Navigate to={landingPath(role)} replace />;
}

/** The signed-in console: the shell as the layout route, every page inside it. */
export function AdminRoutes({ role }: { role: StaffRole | null }) {
  return (
    <Routes>
      <Route element={<AdminShell />}>
        <Route index element={<Landing role={role} />} />
        {ADMIN_ROUTES.map((route) => (
          <Route key={route.id} path={route.path} element={<RouteElement route={route} />} />
        ))}
        <Route path="/applications/:restaurantId" element={<LegacyApplicationRedirect />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
