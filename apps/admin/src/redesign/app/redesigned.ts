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
  // certificate: WP-3
  // ·
  // certificateViewer: WP-3
  // ·
  // restaurants: WP-2
  // ·
  // restaurant: WP-2
  // ·
  // menuItem: WP-4
  // ·
  // riders: WP-5
  // ·
  // rider: WP-5
  // ·
  // issuingBodies: WP-4
  // ·
  // menuReviews: WP-4
  // ·
  // menuReview: WP-4
  // ·
  // orders: WP-6
  // ·
  // disputes: WP-6
  // ·
  // order: WP-7
  // ·
  // refunds: WP-8
  // ·
  // alerts: WP-9
  // ·
  // alert: WP-9
  // ·
  // staff: WP-11
  // ·
  // staffMember: WP-11
  // ·
  // account: WP-10
  // ·
  // system: WP-10
};
