/**
 * Fixture loading.
 *
 * `contracts/fixtures/` holds 310 generated, contract-validated payloads and a scenario
 * menu in its README. The gallery reads them directly rather than inventing data: a
 * component that looks right on data someone made up has proven nothing.
 *
 * Every file has the same envelope — `{scenario, domain, schema, describes, payload}` —
 * so `payloadOf` is the only unwrapping this app does. The casts are the one place the
 * gallery asserts anything about a fixture's type; they are safe because
 * `pnpm validate:fixtures` checks each payload against the OpenAPI schema in CI.
 */
import type { OrderState, Schema } from '@hg/api-client';

import certPanelCertified from '../../../../contracts/fixtures/halal/certification_panel_certified.json';
import certPanelExpiring from '../../../../contracts/fixtures/halal/certification_panel_expiring_soon.json';
import certPanelExpired from '../../../../contracts/fixtures/halal/certification_panel_expired.json';
import certPanelUnverified from '../../../../contracts/fixtures/halal/certification_panel_unverified.json';
import certificateValid from '../../../../contracts/fixtures/halal/halal_certificate_valid.json';
import certificatePending from '../../../../contracts/fixtures/halal/halal_certificate_status_pending.json';
import certificateRejected from '../../../../contracts/fixtures/halal/halal_certificate_status_rejected.json';
import certificateApproved from '../../../../contracts/fixtures/halal/halal_certificate_status_approved.json';
import certificateExpiringTomorrow from '../../../../contracts/fixtures/halal/halal_certificate_expiring_tomorrow.json';
import issuingBodyAccepted from '../../../../contracts/fixtures/halal/halal_issuing_body_accepted.json';

import restaurantList from '../../../../contracts/fixtures/catalogue/restaurant_list_populated.json';
import restaurantListLongNames from '../../../../contracts/fixtures/catalogue/restaurant_list_long_names.json';
import availabilityOpen from '../../../../contracts/fixtures/catalogue/restaurant_availability_open.json';
import availabilityClosed from '../../../../contracts/fixtures/catalogue/restaurant_availability_closed_hours.json';
import availabilityPaused from '../../../../contracts/fixtures/catalogue/restaurant_availability_paused.json';
import availabilityOutOfRange from '../../../../contracts/fixtures/catalogue/restaurant_availability_out_of_range.json';
import availabilityNoAddress from '../../../../contracts/fixtures/catalogue/restaurant_availability_no_address.json';
import menuItemAvailable from '../../../../contracts/fixtures/catalogue/menu_item_available.json';
import menuItemOutOfStock from '../../../../contracts/fixtures/catalogue/menu_item_out_of_stock.json';
import menuItemVariants from '../../../../contracts/fixtures/catalogue/menu_item_many_variants_and_addons.json';
import menuItemLongName from '../../../../contracts/fixtures/catalogue/menu_item_long_name_no_image.json';
import restaurantDetailExpired from '../../../../contracts/fixtures/catalogue/restaurant_detail_expired.json';
import restaurantDetailUnverified from '../../../../contracts/fixtures/catalogue/restaurant_detail_unverified.json';

import orderCustomerPreparing from '../../../../contracts/fixtures/orders/order_preparing.json';
import orderCustomerCancelled from '../../../../contracts/fixtures/orders/order_cancelled.json';
import orderRestaurantPending from '../../../../contracts/fixtures/orders/restaurant_order_restaurant_pending.json';
import orderRestaurantPreparing from '../../../../contracts/fixtures/orders/restaurant_order_preparing.json';
import orderAdminCompleted from '../../../../contracts/fixtures/orders/order_admin_view_completed.json';
import orderAdminDisputed from '../../../../contracts/fixtures/orders/order_admin_view_disputed.json';
import orderAdminFailed from '../../../../contracts/fixtures/orders/order_admin_view_failed_no_rider.json';
import trackingDelivered from '../../../../contracts/fixtures/orders/tracking_delivered.json';
import receiptStandard from '../../../../contracts/fixtures/orders/receipt_standard.json';
import restaurantQueueBusy from '../../../../contracts/fixtures/orders/restaurant_order_queue_busy.json';

import assignmentPickedUp from '../../../../contracts/fixtures/dispatch/assignment_picked_up.json';

import documentApproved from '../../../../contracts/fixtures/documents/document_approved.json';
import presignedDownload from '../../../../contracts/fixtures/documents/presigned_download.json';

import errorInternal from '../../../../contracts/fixtures/errors/error_internal_error.json';
import errorNotFound from '../../../../contracts/fixtures/errors/error_not_found.json';
import errorForbidden from '../../../../contracts/fixtures/errors/error_forbidden.json';
import errorRateLimited from '../../../../contracts/fixtures/errors/error_rate_limited.json';
import errorValidation from '../../../../contracts/fixtures/errors/error_validation_failed.json';
import errorRestaurantClosed from '../../../../contracts/fixtures/errors/error_restaurant_closed.json';
import errorAuthRequired from '../../../../contracts/fixtures/errors/error_authentication_required.json';
import errorUnknownField from '../../../../contracts/fixtures/errors/error_unknown_field.json';

/* -------------------------------------------------------------------------- *
 * Envelope
 * -------------------------------------------------------------------------- */

export interface FixtureEnvelope {
  scenario: string;
  domain: string;
  schema: string;
  describes: string;
  status?: number;
  tags?: readonly string[];
  payload: unknown;
}

/** The provenance line the gallery prints under every specimen fed by a fixture. */
export function cite(fixture: { scenario: string; domain: string }): string {
  return `contracts/fixtures/${fixture.domain}/${fixture.scenario}.json`;
}

function payloadOf<T>(fixture: { payload: unknown }): T {
  return fixture.payload as T;
}

/** Structured-clone helper — fixtures are frozen inputs and are never mutated in place. */
export function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/* -------------------------------------------------------------------------- *
 * Halal
 * -------------------------------------------------------------------------- */

export const halalFixtures = {
  panelCertified: certPanelCertified as FixtureEnvelope,
  panelExpiring: certPanelExpiring as FixtureEnvelope,
  panelExpired: certPanelExpired as FixtureEnvelope,
  panelUnverified: certPanelUnverified as FixtureEnvelope,
  certificateValid: certificateValid as FixtureEnvelope,
  certificatePending: certificatePending as FixtureEnvelope,
  certificateRejected: certificateRejected as FixtureEnvelope,
  certificateApproved: certificateApproved as FixtureEnvelope,
  certificateExpiringTomorrow: certificateExpiringTomorrow as FixtureEnvelope,
  issuingBodyAccepted: issuingBodyAccepted as FixtureEnvelope,
} as const;

export const certificationPanels = {
  CERTIFIED: payloadOf<Schema['CertificationPanel']>(certPanelCertified),
  EXPIRING_SOON: payloadOf<Schema['CertificationPanel']>(certPanelExpiring),
  EXPIRED: payloadOf<Schema['CertificationPanel']>(certPanelExpired),
  UNVERIFIED: payloadOf<Schema['CertificationPanel']>(certPanelUnverified),
} as const;

export const certificates = {
  valid: payloadOf<Schema['HalalCertificate']>(certificateValid),
  pending: payloadOf<Schema['HalalCertificate']>(certificatePending),
  rejected: payloadOf<Schema['HalalCertificate']>(certificateRejected),
  approved: payloadOf<Schema['HalalCertificate']>(certificateApproved),
  expiringTomorrow: payloadOf<Schema['HalalCertificate']>(certificateExpiringTomorrow),
} as const;

export const issuingBody = payloadOf<Schema['HalalIssuingBody']>(issuingBodyAccepted);

/* -------------------------------------------------------------------------- *
 * Catalogue
 * -------------------------------------------------------------------------- */

export const restaurantCards = payloadOf<Schema['RestaurantCard'][]>(restaurantList);
export const restaurantCardsLongNames =
  payloadOf<Schema['RestaurantCard'][]>(restaurantListLongNames);

export const availability = {
  OPEN: payloadOf<Schema['RestaurantAvailabilityInfo']>(availabilityOpen),
  CLOSED_HOURS: payloadOf<Schema['RestaurantAvailabilityInfo']>(availabilityClosed),
  PAUSED: payloadOf<Schema['RestaurantAvailabilityInfo']>(availabilityPaused),
  OUT_OF_RANGE: payloadOf<Schema['RestaurantAvailabilityInfo']>(availabilityOutOfRange),
  NO_ADDRESS: payloadOf<Schema['RestaurantAvailabilityInfo']>(availabilityNoAddress),
} as const;

export const menuItems = {
  available: payloadOf<Schema['MenuItem']>(menuItemAvailable),
  outOfStock: payloadOf<Schema['MenuItem']>(menuItemOutOfStock),
  variants: payloadOf<Schema['MenuItem']>(menuItemVariants),
  longName: payloadOf<Schema['MenuItem']>(menuItemLongName),
} as const;

export const restaurantDetails = {
  expired: payloadOf<Schema['RestaurantDetail']>(restaurantDetailExpired),
  unverified: payloadOf<Schema['RestaurantDetail']>(restaurantDetailUnverified),
} as const;

export const catalogueFixtures = {
  restaurantList: restaurantList as FixtureEnvelope,
  restaurantListLongNames: restaurantListLongNames as FixtureEnvelope,
  menuItemAvailable: menuItemAvailable as FixtureEnvelope,
  menuItemOutOfStock: menuItemOutOfStock as FixtureEnvelope,
  menuItemVariants: menuItemVariants as FixtureEnvelope,
  menuItemLongName: menuItemLongName as FixtureEnvelope,
  restaurantDetailExpired: restaurantDetailExpired as FixtureEnvelope,
  restaurantDetailUnverified: restaurantDetailUnverified as FixtureEnvelope,
  availabilityOpen: availabilityOpen as FixtureEnvelope,
  availabilityClosed: availabilityClosed as FixtureEnvelope,
  availabilityPaused: availabilityPaused as FixtureEnvelope,
  availabilityOutOfRange: availabilityOutOfRange as FixtureEnvelope,
  availabilityNoAddress: availabilityNoAddress as FixtureEnvelope,
} as const;

/* -------------------------------------------------------------------------- *
 * Orders
 * -------------------------------------------------------------------------- */

export const orders = {
  customerPreparing: payloadOf<Schema['OrderCustomerView']>(orderCustomerPreparing),
  customerCancelled: payloadOf<Schema['OrderCustomerView']>(orderCustomerCancelled),
  restaurantPending: payloadOf<Schema['OrderRestaurantView']>(orderRestaurantPending),
  restaurantPreparing: payloadOf<Schema['OrderRestaurantView']>(orderRestaurantPreparing),
  adminCompleted: payloadOf<Schema['OrderAdminView']>(orderAdminCompleted),
  adminDisputed: payloadOf<Schema['OrderAdminView']>(orderAdminDisputed),
  adminFailed: payloadOf<Schema['OrderAdminView']>(orderAdminFailed),
  riderAssignment: payloadOf<Schema['Assignment']>(assignmentPickedUp),
  receipt: payloadOf<Schema['Receipt']>(receiptStandard),
} as const;

/**
 * The busy restaurant queue — orders with a server-masked customer phone on each, which
 * is what the PII table is built from.
 *
 * The fixture carries **six entries but only three distinct order ids**: `face3cd1…`
 * appears twice and `c622bd1b…` three times. Rendering it as-is collides React keys and
 * would make row selection ambiguous, so the gallery de-duplicates by id and reports the
 * duplication as a finding rather than hiding it.
 */
const RESTAURANT_QUEUE_RAW = payloadOf<Schema['OrderRestaurantView'][]>(restaurantQueueBusy);

export const restaurantQueue: readonly Schema['OrderRestaurantView'][] = Object.values(
  RESTAURANT_QUEUE_RAW,
).filter(
  (order, index, all) => all.findIndex((candidate) => candidate.id === order.id) === index,
);

export const RESTAURANT_QUEUE_DUPLICATES = {
  entries: Object.values(RESTAURANT_QUEUE_RAW).length,
  distinct: restaurantQueue.length,
};

export const orderFixtures = {
  customerPreparing: orderCustomerPreparing as FixtureEnvelope,
  customerCancelled: orderCustomerCancelled as FixtureEnvelope,
  restaurantPending: orderRestaurantPending as FixtureEnvelope,
  restaurantPreparing: orderRestaurantPreparing as FixtureEnvelope,
  adminCompleted: orderAdminCompleted as FixtureEnvelope,
  adminDisputed: orderAdminDisputed as FixtureEnvelope,
  adminFailed: orderAdminFailed as FixtureEnvelope,
  riderAssignment: assignmentPickedUp as FixtureEnvelope,
  trackingDelivered: trackingDelivered as FixtureEnvelope,
  restaurantQueueBusy: restaurantQueueBusy as unknown as FixtureEnvelope,
} as const;

interface WireTransition {
  from_state: OrderState | null;
  to_state: OrderState;
  at: string;
}

/**
 * The one real transition log in the fixture set — a complete `CREATED → DELIVERED` run.
 * Every timeline specimen is a slice of this, so no timestamp in the gallery is invented.
 */
export const DELIVERED_TRANSITIONS: readonly { state: OrderState; at: string }[] = (
  payloadOf<{ timeline: WireTransition[] }>(trackingDelivered).timeline ?? []
).map((entry) => ({ state: entry.to_state, at: entry.at }));

/** The branch timestamps, taken from the terminal order fixtures rather than made up. */
export const BRANCH_AT: Partial<Record<OrderState, string>> = {
  CANCELLED: payloadOf<{ state_since: string }>(orderCustomerCancelled).state_since,
  REJECTED: payloadOf<{ state_since: string }>(orderAdminFailed).state_since,
  FAILED: payloadOf<{ state_since: string }>(orderAdminFailed).state_since,
  DISPUTED: payloadOf<{ state_since: string }>(orderAdminDisputed).state_since,
  RESOLVED: payloadOf<{ state_since: string }>(orderAdminDisputed).state_since,
};

/**
 * Transitions for a given state: the real log truncated at that state. For a terminal
 * branch the spine is truncated where the fixture says the order actually got to, and the
 * branch transition is appended with the fixture's own `state_since`.
 */
export function transitionsFor(
  state: OrderState,
  spineReached?: OrderState,
): readonly { state: OrderState; at: string }[] {
  const branchAt = BRANCH_AT[state];
  if (branchAt) {
    const cutoff = spineReached ?? 'RESTAURANT_PENDING';
    const index = DELIVERED_TRANSITIONS.findIndex((t) => t.state === cutoff);
    const spine = index >= 0 ? DELIVERED_TRANSITIONS.slice(0, index + 1) : [];
    return [...spine, { state, at: branchAt }];
  }
  const index = DELIVERED_TRANSITIONS.findIndex((t) => t.state === state);
  if (index >= 0) return DELIVERED_TRANSITIONS.slice(0, index + 1);
  // COMPLETED has no transition row in the log; it follows DELIVERED.
  return DELIVERED_TRANSITIONS;
}

/* -------------------------------------------------------------------------- *
 * Documents and errors
 * -------------------------------------------------------------------------- */

export const documents = {
  approved: payloadOf<Schema['KycDocument']>(documentApproved),
  presigned: payloadOf<Schema['PresignedDownload']>(presignedDownload),
} as const;

export const documentFixtures = {
  approved: documentApproved as FixtureEnvelope,
  presigned: presignedDownload as FixtureEnvelope,
} as const;

export interface WireError {
  error: {
    code: string;
    message: string;
    request_id?: string | null;
    details?: unknown;
  };
}

export const errorFixtures: readonly (FixtureEnvelope & { payload: WireError })[] = [
  errorInternal,
  errorNotFound,
  errorForbidden,
  errorRateLimited,
  errorValidation,
  errorRestaurantClosed,
  errorAuthRequired,
  errorUnknownField,
] as unknown as readonly (FixtureEnvelope & { payload: WireError })[];
