/**
 * Redesigned screens, one entry per route id. A route with no entry here falls back to the legacy
 * screen (inside the new shell) or to the "Not built yet" section (`./routes.tsx`).
 *
 * Each work package replaces ONLY its own commented line below with a lazy import of its route
 * element, for example:
 *
 *     restaurants: lazy(() => import('../restaurants/RestaurantQueueRoute')),
 *
 * The lines are kept apart by a spacer comment so two WP branches never touch adjacent lines and
 * merge without conflict. Do not reorder, and do not add imports at the top: use `lazy` inline.
 */
// `lazy` is imported for the entries below, before any WP has added one.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

import type { RouteId } from './routes';

type Screen = ComponentType | LazyExoticComponent<ComponentType>;

export const REDESIGNED: Partial<Record<RouteId, Screen>> = {
  // certificates: (shell page, Q7) WP-3 may replace it once the register has an API
  // ·
  certificate: lazy(() => import('../verification/console/CertificateConsoleRoute')),
  // ·
  certificateViewer: lazy(() => import('../verification/viewer/CertificateViewerRoute')),
  // ·
  restaurants: lazy(() => import('../verification/queue/RestaurantQueueRoute')),
  // ·
  restaurant: lazy(() => import('../verification/application/RestaurantApplicationRoute')),
  // ·
  // menuItem: WP-4
  // ·
  riders: lazy(() => import('../riders/queue/RiderQueueRoute')),
  // ·
  rider: lazy(() => import('../riders/application/RiderApplicationRoute')),
  // ·
  // issuingBodies: WP-4
  // ·
  // menuReviews: WP-4
  // ·
  // menuReview: WP-4
  // ·
  orders: lazy(() => import('../orders/OrdersRoute')),
  // ·
  disputes: lazy(() => import('../orders/DisputesRoute')),
  // ·
  order: lazy(() => import('../orders/workspace/OrderRoute')),
  // ·
  refunds: lazy(() => import('../refunds/RefundsRoute')),
  // ·
  alerts: lazy(() => import('../alerts/AlertsRoute')),
  // ·
  alert: lazy(() => import('../alerts/AlertsRoute')),
  // ·
  staff: lazy(() => import('../staff/StaffRoute')),
  // ·
  staffMember: lazy(() => import('../staff/StaffRoute')),
  // ·
  account: lazy(() => import('../account/AccountRoute')),
  // ·
  system: lazy(() => import('../system/SystemRoute')),
};
