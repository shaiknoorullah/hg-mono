/**
 * Every domain specimen in this gallery is populated from `contracts/fixtures/` — the 311 real
 * scenario files the contract kit generates and validates. Nothing here invents a restaurant, a
 * price or a certificate.
 *
 * The JSON is typed structurally rather than nominally: `resolveJsonModule` infers `state: string`
 * where the contract says `state: OrderState`, so each fixture is cast once, here, to the schema
 * the components declare. The cast is the only place widening happens.
 */
import type { Schema } from '@hg/api-client';
import type { Certification, Restaurant, Availability, MenuItem } from '@hg/ui-native';

/* eslint-disable @typescript-eslint/no-explicit-any */

import restaurantListPopulated from '../../../contracts/fixtures/catalogue/restaurant_list_populated.json';
import restaurantListLongNames from '../../../contracts/fixtures/catalogue/restaurant_list_long_names.json';
import restaurantListMissingImages from '../../../contracts/fixtures/catalogue/restaurant_list_missing_images.json';
import availabilityClosed from '../../../contracts/fixtures/catalogue/restaurant_availability_closed_hours.json';
import availabilityPaused from '../../../contracts/fixtures/catalogue/restaurant_availability_paused.json';
import availabilityOutOfRange from '../../../contracts/fixtures/catalogue/restaurant_availability_out_of_range.json';

import panelCertified from '../../../contracts/fixtures/halal/certification_panel_certified.json';
import panelExpiringSoon from '../../../contracts/fixtures/halal/certification_panel_expiring_soon.json';
import panelExpired from '../../../contracts/fixtures/halal/certification_panel_expired.json';
import panelUnverified from '../../../contracts/fixtures/halal/certification_panel_unverified.json';

import menuItemAvailable from '../../../contracts/fixtures/catalogue/menu_item_available.json';
import menuItemOutOfStock from '../../../contracts/fixtures/catalogue/menu_item_out_of_stock.json';
import menuItemManyVariants from '../../../contracts/fixtures/catalogue/menu_item_many_variants_and_addons.json';
import menuItemLongName from '../../../contracts/fixtures/catalogue/menu_item_long_name_no_image.json';

import orderListActive from '../../../contracts/fixtures/orders/order_list_active.json';
import orderListPast from '../../../contracts/fixtures/orders/order_list_past.json';
import restaurantOrderPending from '../../../contracts/fixtures/orders/restaurant_order_restaurant_pending.json';
import restaurantOrderPreparing from '../../../contracts/fixtures/orders/restaurant_order_preparing.json';
import orderAdminCompleted from '../../../contracts/fixtures/orders/order_admin_view_completed.json';
import orderAdminDisputed from '../../../contracts/fixtures/orders/order_admin_view_disputed.json';

import trackingPickedUp from '../../../contracts/fixtures/orders/tracking_picked_up.json';
import trackingArrived from '../../../contracts/fixtures/orders/tracking_arrived.json';
import trackingDegradedGps from '../../../contracts/fixtures/orders/tracking_degraded_gps.json';
import orderCancelled from '../../../contracts/fixtures/orders/order_cancelled.json';

import offerPending from '../../../contracts/fixtures/dispatch/offer_pending.json';
import assignmentPickedUp from '../../../contracts/fixtures/dispatch/assignment_picked_up.json';

import quoteStandard from '../../../contracts/fixtures/cart/quote_standard.json';

const payload = <T,>(f: { payload: unknown }): T => f.payload as T;

/* ------------------------------------------------------------------------- catalogue */

export const restaurants = payload<Restaurant[]>(restaurantListPopulated as any);
export const restaurantsLongNames = payload<Restaurant[]>(restaurantListLongNames as any);
export const restaurantsMissingImages = payload<Restaurant[]>(restaurantListMissingImages as any);

export const availability = {
  closed: payload<Availability>(availabilityClosed as any),
  paused: payload<Availability>(availabilityPaused as any),
  outOfRange: payload<Availability>(availabilityOutOfRange as any),
};

/**
 * The list fixture is all `CERTIFIED` plus one `EXPIRING_SOON`, because C-12 R1 means an
 * uncertified kitchen never reaches a customer list. To show the seal's other two states on a
 * card the display state is overridden on a copy of a real card — labelled `forced` wherever it
 * appears.
 */
export function withHalalState(
  restaurant: Restaurant,
  displayState: 'CERTIFIED' | 'EXPIRING_SOON' | 'EXPIRED' | 'UNVERIFIED',
): Restaurant {
  return {
    ...restaurant,
    halal: { ...(restaurant.halal as object), display_state: displayState },
  } as Restaurant;
}

/** Deletes `halal` entirely — the C-12 R4 "no state is ever assumed" path. */
export function withoutHalal(restaurant: Restaurant): Restaurant {
  const next = { ...restaurant } as Record<string, unknown>;
  delete next.halal;
  return next as Restaurant;
}

/* ---------------------------------------------------------------------- certification */

export const certifications = {
  certified: payload<Certification>(panelCertified as any),
  expiringSoon: payload<Certification>(panelExpiringSoon as any),
  expired: payload<Certification>(panelExpired as any),
  unverified: payload<Certification>(panelUnverified as any),
};

/* ------------------------------------------------------------------------------ menu */

export const menuItems = {
  available: payload<MenuItem>(menuItemAvailable as any),
  outOfStock: payload<MenuItem>(menuItemOutOfStock as any),
  manyVariants: payload<MenuItem>(menuItemManyVariants as any),
  longNameNoImage: payload<MenuItem>(menuItemLongName as any),
};

/* ---------------------------------------------------------------------------- orders */

export const orders = {
  active: payload<Schema['OrderSummary'][]>(orderListActive as any),
  past: payload<Schema['OrderSummary'][]>(orderListPast as any),
  restaurantPending: payload<Schema['OrderRestaurantView']>(restaurantOrderPending as any),
  restaurantPreparing: payload<Schema['OrderRestaurantView']>(restaurantOrderPreparing as any),
  adminCompleted: payload<Schema['OrderAdminView']>(orderAdminCompleted as any),
  adminDisputed: payload<Schema['OrderAdminView']>(orderAdminDisputed as any),
  cancelled: payload<Schema['OrderCustomerView']>(orderCancelled as any),
};

export const tracking = {
  pickedUp: payload<Schema['OrderTracking']>(trackingPickedUp as any),
  arrived: payload<Schema['OrderTracking']>(trackingArrived as any),
  degradedGps: payload<Schema['OrderTracking']>(trackingDegradedGps as any),
};

/* -------------------------------------------------------------------------- dispatch */

export const dispatch = {
  offer: payload<Schema['DispatchOffer']>(offerPending as any),
  assignment: payload<Schema['Assignment']>(assignmentPickedUp as any),
};

/* ------------------------------------------------------------------------------ cart */

export const quote = payload<Schema['Quote']>(quoteStandard as any);

/** Fixture provenance, rendered next to specimens so a reviewer can open the source file. */
export const SOURCE = {
  restaurants: 'contracts/fixtures/catalogue/restaurant_list_populated.json',
  restaurantsLongNames: 'contracts/fixtures/catalogue/restaurant_list_long_names.json',
  restaurantsMissingImages: 'contracts/fixtures/catalogue/restaurant_list_missing_images.json',
  certifications: 'contracts/fixtures/halal/certification_panel_*.json',
  menu: 'contracts/fixtures/catalogue/menu_item_*.json',
  orders: 'contracts/fixtures/orders/*.json',
  tracking: 'contracts/fixtures/orders/tracking_*.json',
  offer: 'contracts/fixtures/dispatch/offer_pending.json',
  assignment: 'contracts/fixtures/dispatch/assignment_picked_up.json',
  quote: 'contracts/fixtures/cart/quote_standard.json',
} as const;
