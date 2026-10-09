/* Rider kit sample data. Every value mirrors a contract field (contracts/openapi.yaml) and every
   id is UUIDv7-shaped (K-06); the human order reference is Assignment.order_code.
   Money is always a *_cents value from the payload. The kit never adds, subtracts or scales money. */

const RIDER_ME = {
  id: '0192f1a8-7c3e-7b2a-9d41-5e8f3a6c2b17',
  first_name: 'Yusuf', last_initial: 'A', phone: '+1 416 555 0134',
  vehicle: { vehicle_type: 'SCOOTER', plate: 'CJRA 204', make_model: 'Honda PCX 125' },
};

/* RiderDashboard.today */
const TODAY = { gross_cents: 4280, currency: 'CAD', trips: 7, online_seconds: 11520 };

/* RiderDashboard.current_offer: a single DispatchOffer (K-32). Pre-acceptance: dropoff.area only (K-35). */
const OFFER = {
  offer_id: '0192f1b2-0d44-7e19-8a6c-3f2b91d0c4e5',
  order_id: '0192f1b1-f3a0-7c88-b2d1-6e4a07c9d3f1',
  state: 'PENDING', wave: 1,
  server_time: '2026-09-28T22:47:02Z',
  expires_at: '2026-09-28T22:47:32Z', /* offer_ttl_seconds = 30 */
  pickup: { restaurant_name: 'Zaytoun Grill', address_short: 'Ellesmere Rd, Scarborough' },
  dropoff: { area: 'Brimley Rd, Scarborough' },
  distance_m: 4800, est_duration_s: 840, items_count: 3,
  earnings: { base_cents: 350, distance_cents: 384, surge_cents: 0, tip_so_far_cents: 210, estimated_total_cents: 944, currency: 'CAD' },
};

/* Assignment payload: arrives only after acceptance, so buzzer/unit/instructions live here. */
const ASSIGNMENT = {
  id: '0192f1b2-2a91-7f03-9c5e-81d4b6a0e2c7',
  order_id: OFFER.order_id, order_code: 'HG-4K2M-9T',
  pickup: {
    restaurant_name: 'Zaytoun Grill', address: '14 Ellesmere Rd, Scarborough, ON',
    phone_alias: '+1 647 555 0190', pickup_notes: 'Collect at the side counter. Ask for the order code.', order_state: 'PREPARING',
  },
  dropoff: {
    address: '88 Brimley Rd, Scarborough, ON', unit: '402', buzzer: '4021',
    customer_display_name: 'Aisha M.', phone_alias: '+1 647 555 0117',
    delivery_instructions: ['LEAVE_AT_DOOR', 'DO_NOT_RING_BELL'], special_instructions: 'Blue door at the end of the hall.',
  },
  items: [
    { name: 'Mixed charcoal grill', quantity: 1, variant_name: 'For two', addon_names: ['Extra garlic sauce'], note: null, allergen_tags: ['SESAME', 'MILK'] },
    { name: 'Chicken shawarma wrap', quantity: 2, variant_name: null, addon_names: [], note: 'No pickles', allergen_tags: ['WHEAT_TRITICALE'] },
  ],
  required_pod_method: 'PHOTO',
  earnings: OFFER.earnings,
  tracking_health: 'HEALTHY',
};

const INSTRUCTION_TEXT = {
  LEAVE_AT_DOOR: 'Leave at the door', DO_NOT_RING_BELL: 'Do not ring the bell', DO_NOT_CALL: 'Do not call',
  MEET_AT_DOOR: 'Meet at the door', MEET_IN_LOBBY: 'Meet in the lobby',
};
const ALLERGEN_TEXT = {
  PEANUTS: 'Peanuts', TREE_NUTS: 'Tree nuts', SESAME: 'Sesame', MILK: 'Milk', EGGS: 'Eggs', FISH: 'Fish',
  CRUSTACEANS_MOLLUSCS: 'Shellfish', SOY: 'Soy', WHEAT_TRITICALE: 'Wheat', SULPHITES: 'Sulphites', MUSTARD: 'Mustard',
};
const OFFER_REJECT_REASONS = [
  ['TOO_FAR_PICKUP', 'Pickup is too far'], ['TOO_FAR_DROPOFF', 'Drop-off is too far'], ['TOO_LONG_WAIT', 'Wait looks too long'],
  ['EARNINGS_TOO_LOW', 'Earnings too low'], ['VEHICLE_UNSUITABLE', 'Not suitable for my vehicle'], ['ORDER_TOO_LARGE', 'Order too large'],
  ['ENDING_SHIFT', 'Ending my shift'], ['PERSONAL_BREAK', 'Taking a break'], ['SAFETY_CONCERN', 'Safety concern'], ['OTHER', 'Other'],
];
const VEHICLES = [
  ['BICYCLE', 'Bicycle'], ['ON_FOOT', 'On foot'], ['SCOOTER', 'Scooter'], ['MOTORCYCLE', 'Motorcycle'], ['CAR', 'Car'],
];
/* RiderDocType per vehicle (D-05 / A-23) */
const DOCS_FOR = {
  motorised: [['DRIVERS_LICENCE', "Driver's licence"], ['VEHICLE_REGISTRATION', 'Vehicle registration'], ['VEHICLE_INSURANCE', 'Vehicle insurance'], ['PROFILE_PHOTO', 'Profile photo']],
  unpowered: [['GOVERNMENT_ID', 'Government ID'], ['PROFILE_PHOTO', 'Profile photo']],
};

/* EarningsSummary (period WEEK). Buckets and totals are server numbers, shown as given. */
const EARNINGS = {
  period: 'WEEK', currency: 'CAD', unpaid_balance_cents: 21860, next_payout_at: '2026-10-05T14:00:00Z',
  total: { bucket_start: '2026-09-22T04:00:00Z', gross_cents: 34370, trips: 57, online_seconds: 118800 },
  buckets: [
    ['2026-09-28', 'Sun 28 Sept', 4280, 7], ['2026-09-27', 'Sat 27 Sept', 7180, 12], ['2026-09-26', 'Fri 26 Sept', 6740, 11],
    ['2026-09-25', 'Thu 25 Sept', 5210, 9], ['2026-09-24', 'Wed 24 Sept', 2980, 5], ['2026-09-23', 'Tue 23 Sept', 4160, 7], ['2026-09-22', 'Mon 22 Sept', 3820, 6],
  ],
};

/* GET /v1/riders/me/payouts: Payout rows. Weekly, Monday (claims.ts MONEY.payoutDay, S-04). */
const PAYOUTS = [
  { id: '0192e3c4-5b10-7a2e-8f63-2c9d4e1b7a05', period_start: '15 Sept', period_end: '21 Sept 2026', amount_cents: 31240, state: 'PAID', entry_count: 52, paid_at: 'Mon 22 Sept 2026', hold_reason: null, failure_message: null },
  { id: '0192ded0-11c7-7d4b-a0e9-6b3f8c2d1e44', period_start: '8 Sept', period_end: '14 Sept 2026', amount_cents: 28790, state: 'PAID', entry_count: 47, paid_at: 'Mon 15 Sept 2026', hold_reason: null, failure_message: null },
  { id: '0192d9dc-8e02-7f61-b4a7-0d5c3e9f2b18', period_start: '1 Sept', period_end: '7 Sept 2026', amount_cents: 26410, state: 'PAID', entry_count: 44, paid_at: 'Mon 8 Sept 2026', hold_reason: null, failure_message: null },
];
const PAYOUT_TONE = { DRAFT: 'outline', READY: 'outline', TRANSFERRING: 'info', TRANSFERRED: 'info', PAID: 'outline', FAILED: 'warning', HELD: 'warning' };
const PAYOUT_LABEL = { DRAFT: 'Draft', READY: 'Ready', TRANSFERRING: 'Transferring', TRANSFERRED: 'Transferred', PAID: 'Paid', FAILED: 'Failed', HELD: 'Held' };

/* Delivery history: past assignments (state only, no money: amounts live in Earnings). */
const HISTORY = [
  { id: '0192f1a0-4d2e-7b91-9c0a-7e3f5b2d8c61', order_code: 'HG-7R2P-4C', restaurant: 'Karahi House', area: 'Midland Ave, Scarborough', at: 'Today 17:58', state: 'DELIVERED' },
  { id: '0192f19a-9b13-7c20-8e44-1a6d0f7c3b92', order_code: 'HG-2M9D-1K', restaurant: 'Anatolia Doner', area: 'Kennedy Rd, Scarborough', at: 'Today 16:40', state: 'DELIVERED' },
  { id: '0192f18e-0f57-7a6d-b3c8-5d2e9a1f4c07', order_code: 'HG-9Q4T-8W', restaurant: 'Zaytoun Grill', area: 'Warden Ave, Scarborough', at: 'Today 15:12', state: 'RETURNED' },
  { id: '0192f182-6c31-7e08-9f15-3b7a2c4d6e90', order_code: 'HG-1H6V-3N', restaurant: 'Sufra Kitchen', area: 'Eglinton Ave E, Scarborough', at: 'Yesterday 21:03', state: 'CANCELLED_BY_PLATFORM' },
];
const ASSIGNMENT_LABEL = {
  DELIVERED: ['Delivered', 'outline'], RETURNED: ['Returned to restaurant', 'warning'], UNDELIVERABLE: ['Undeliverable', 'warning'],
  CANCELLED_BY_PLATFORM: ['Cancelled by HalalGoes', 'outline'], REASSIGNED: ['Reassigned', 'outline'],
};

/* KycDocument rows for Profile / fix-documents */
const DOCUMENTS = [
  { doc_type: 'DRIVERS_LICENCE', label: "Driver's licence", state: 'APPROVED', valid_until: '14 Mar 2029' },
  { doc_type: 'VEHICLE_REGISTRATION', label: 'Vehicle registration', state: 'APPROVED', valid_until: '2 Feb 2027' },
  { doc_type: 'VEHICLE_INSURANCE', label: 'Vehicle insurance', state: 'APPROVED', valid_until: '30 Nov 2026' },
  { doc_type: 'PROFILE_PHOTO', label: 'Profile photo', state: 'APPROVED', valid_until: null },
];
const KYC_TONE = { SUBMITTED: 'info', IN_REVIEW: 'info', APPROVED: 'outline', REJECTED: 'warning', EXPIRED: 'warning', SUPERSEDED: 'outline' };
const KYC_LABEL = { SUBMITTED: 'Submitted', IN_REVIEW: 'In review', APPROVED: 'Approved', REJECTED: 'Needs a new upload', EXPIRED: 'Expired', SUPERSEDED: 'Replaced' };

/* Display-only helpers. Formatting, never arithmetic on money. */
const kmText = m => (m / 1000).toFixed(1) + ' km';
const minText = s => Math.round(s / 60) + ' min';
const hoursText = s => Math.floor(s / 3600) + 'h ' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + 'm';
/* Offer countdown is computed from the SERVER's clock (expires_at − server_time), never from a local constant. */
const secondsLeft = o => Math.max(0, Math.round((Date.parse(o.expires_at) - Date.parse(o.server_time)) / 1000));

Object.assign(window, {
  RIDER_ME, TODAY, OFFER, ASSIGNMENT, INSTRUCTION_TEXT, ALLERGEN_TEXT, OFFER_REJECT_REASONS, VEHICLES, DOCS_FOR,
  EARNINGS, PAYOUTS, PAYOUT_TONE, PAYOUT_LABEL, HISTORY, ASSIGNMENT_LABEL, DOCUMENTS, KYC_TONE, KYC_LABEL,
  kmText, minText, hoursText, secondsLeft,
});
