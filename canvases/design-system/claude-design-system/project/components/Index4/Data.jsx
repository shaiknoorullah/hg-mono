/* Sample data for the restaurant kit. Every field below exists in contracts/openapi.yaml; the
   shapes follow OrderSummary/OrderRestaurantView, RestaurantAvailability, MenuItemOwnerView +
   MenuItemVersion, RestaurantHours, Payout, ConnectStatus, RestaurantStaffUser and KycDocument.
   Ids are UUIDv7-shaped (the contract's `format: uuid`); people read the short order `code`.
   Money is server-priced integer cents; the kit never adds, taxes or discounts anything. */

const SERVER_TIME = '2026-09-12T18:48:00-04:00';
const secondsUntil = iso => Math.max(0, Math.round((Date.parse(iso) - Date.parse(SERVER_TIME)) / 1000));
const hhmm = iso => iso ? iso.slice(11, 16) : '—';

const RESTAURANT = {
  id: '0191c2d4-5e7a-7f3b-8c21-4a9d0e6b2f11',
  display_name: 'Zaytoun Grill',
  legal_name: 'Zaytoun Grill Holdings Inc.',
  address: '14 Ellesmere Rd, Scarborough, ON M1R 4B5',
  phone: '(416) 555-0134',
  cuisines: ['Levantine', 'Grill'],
};

/* RestaurantAvailability (R-22). last_heartbeat_at comes from POST /v1/restaurant/heartbeat. */
const AVAILABILITY = {
  live: { open_state: 'OPEN', is_accepting_orders: true, last_heartbeat_at: '2026-09-12T18:47:48-04:00', missed_order_count: 0 },
  missed: { open_state: 'OPEN', is_accepting_orders: true, last_heartbeat_at: '2026-09-12T18:47:48-04:00', missed_order_count: 2 },
  offline: { open_state: 'CLOSED_OFFLINE', is_accepting_orders: true, last_heartbeat_at: '2026-09-12T18:41:02-04:00', missed_order_count: 0 },
  paused: { open_state: 'PAUSED', is_accepting_orders: true, pause_until: '2026-09-12T19:10:00-04:00', last_heartbeat_at: '2026-09-12T18:47:48-04:00', missed_order_count: 0 },
};

/* Restaurant-side orders. state is OrderState; deadline_at drives the accept window (180 s). */
const ORDERS = [
  { id: '0192f3a4-7c1e-7b2d-9a41-3c5e8f0b1d27', code: 'K7Q2', state: 'RESTAURANT_PENDING', customer: 'Aisha M.', placed_at: '2026-09-12T18:47:36-04:00', deadline_at: '2026-09-12T18:49:36-04:00', total_cents: 4187,
    lines: [{ quantity: 1, name: 'Mixed charcoal grill', note: 'No onions' }, { quantity: 2, name: 'Chicken shawarma wrap', addon_names: ['Extra toum'] }] },
  { id: '0192f3a4-6b0d-7a1c-8e30-2b4d7e9a0c16', code: 'K7P9', state: 'RESTAURANT_PENDING', customer: 'Omar S.', placed_at: '2026-09-12T18:46:40-04:00', deadline_at: '2026-09-12T18:49:40-04:00', total_cents: 2650,
    lines: [{ quantity: 1, name: 'Falafel plate' }, { quantity: 1, name: 'Mint lemonade' }] },
  { id: '0192f3a3-9f2c-7e4b-a153-1c3b6d8f9e05', code: 'K7M4', state: 'PREPARING', customer: 'Sara K.', placed_at: '2026-09-12T18:38:02-04:00', seal_code: null, total_cents: 3199,
    lines: [{ quantity: 2, name: 'Adana kebab' }] },
  { id: '0192f3a3-5a1b-7d3a-b042-0b2a5c7e8d94', code: 'K7L8', state: 'PREPARING', customer: 'Bilal R.', placed_at: '2026-09-12T18:34:10-04:00', seal_code: 'HG-48213', total_cents: 1899,
    lines: [{ quantity: 1, name: 'Chicken shish plate' }] },
  { id: '0192f3a2-e4f0-7c29-8f31-fa19b4d6c783', code: 'K7J1', state: 'READY_FOR_PICKUP', customer: 'Hana A.', placed_at: '2026-09-12T18:29:44-04:00', seal_code: 'HG-48207', total_cents: 2499,
    lines: [{ quantity: 1, name: 'Mixed charcoal grill' }] },
  { id: '0192f3a2-2d9e-7b18-9e20-e908a3c5b672', code: 'K7G5', state: 'PICKED_UP', customer: 'Noor T.', placed_at: '2026-09-12T18:12:20-04:00', picked_up_at: '2026-09-12T18:31:05-04:00', seal_code: 'HG-48199', total_cents: 1749,
    lines: [{ quantity: 1, name: 'Doner plate' }] },
];

const REJECT_REASONS = [
  ['ITEM_UNAVAILABLE', 'An item is unavailable'], ['KITCHEN_AT_CAPACITY', 'Kitchen at capacity'], ['CLOSING_SOON', 'Closing soon'],
  ['EQUIPMENT_FAILURE', 'Equipment failure'], ['ADDRESS_OUT_OF_RANGE', 'Address out of range'], ['SUSPECTED_FRAUD', 'Suspected fraud'], ['OTHER', 'Other'],
];
const DELAY_REASONS = [
  ['HIGH_VOLUME', 'High volume'], ['INGREDIENT_PREP', 'Ingredient prep'], ['EQUIPMENT_ISSUE', 'Equipment issue'],
  ['STAFF_SHORTAGE', 'Staff shortage'], ['ORDER_COMPLEXITY', 'Order complexity'], ['OTHER', 'Other'],
];

/* MenuItemOwnerView grouped by MenuCategory. pending_version / live_version are MenuItemVersion. */
const MENU = [
  { category: 'Charcoal grills', items: [
    { id: '0191c2d5-0a11-7c01-9d10-5e2f1a3b4c01', name: 'Mixed charcoal grill', image_url: null, price_cents: 2499, availability_state: 'AVAILABLE', dietary_tags: [], review: 'APPROVED' },
    { id: '0191c2d5-0a11-7c01-9d10-5e2f1a3b4c02', name: 'Adana kebab', image_url: null, price_cents: 2199, availability_state: 'OUT_OF_STOCK', out_of_stock_until: '2026-09-12T20:30:00-04:00', dietary_tags: ['SPICY'], review: 'APPROVED' },
  ] },
  { category: 'Wraps', items: [
    { id: '0191c2d5-0a11-7c01-9d10-5e2f1a3b4c03', name: 'Chicken shawarma wrap', image_url: null, price_cents: 1249, availability_state: 'AVAILABLE', dietary_tags: [], review: 'PENDING_REVIEW', pending_note: 'Description and allergens edited' },
  ] },
  { category: 'Plates', items: [
    { id: '0191c2d5-0a11-7c01-9d10-5e2f1a3b4c04', name: 'Falafel plate', image_url: null, price_cents: 1399, availability_state: 'AVAILABLE', dietary_tags: ['VEGETARIAN'], review: 'REJECTED', rejection_reason_code: 'INCORRECT_DIETARY_TAG', review_note: 'Tagged VEGAN but served with yoghurt sauce.' },
    { id: '0191c2d5-0a11-7c01-9d10-5e2f1a3b4c05', name: 'Lamb mandi', image_url: null, price_cents: 2299, availability_state: 'BLOCKED', dietary_tags: [], review: 'APPROVED' },
  ] },
  { category: 'Drinks', items: [
    { id: '0191c2d5-0a11-7c01-9d10-5e2f1a3b4c06', name: 'Mint lemonade', image_url: null, price_cents: 449, availability_state: 'HIDDEN', dietary_tags: ['VEGAN'], review: 'APPROVED' },
  ] },
];

/* RestaurantHours: day_of_week 0 = Sunday, evaluated in the restaurant's timezone. */
const HOURS = {
  timezone: 'America/Toronto',
  intervals: [
    [1, '11:00', '23:00'], [2, '11:00', '23:00'], [3, '11:00', '23:00'], [4, '11:00', '23:00'],
    [5, '12:00', '01:00', true], [6, '12:00', '01:00', true], [0, '12:00', '22:00'],
  ],
  overrides: [
    { date: '2026-10-12', is_closed: true, reason: 'Thanksgiving' },
    { date: '2026-12-24', is_closed: false, opens_at: '12:00', closes_at: '18:00', reason: 'Early close' },
  ],
};
const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* Payout (PayoutState) + ConnectStatus. Payouts go out weekly on Monday (S-04). */
const PAYOUTS = [
  { id: '0192f1c0-11aa-7e00-8b10-000000000004', period: '7–13 Sept 2026', amount_cents: 289400, entry_count: 126, state: 'READY' },
  { id: '0192f1c0-11aa-7e00-8b10-000000000003', period: '31 Aug–6 Sept 2026', amount_cents: 412300, entry_count: 184, state: 'TRANSFERRING' },
  { id: '0192f1c0-11aa-7e00-8b10-000000000002', period: '24–30 Aug 2026', amount_cents: 338700, entry_count: 151, state: 'HELD', hold_reason: 'Open dispute on order K5X2 — held until resolved' },
  { id: '0192f1c0-11aa-7e00-8b10-000000000001', period: '17–23 Aug 2026', amount_cents: 305100, entry_count: 143, state: 'FAILED', failure_message: 'The bank rejected the transfer: account closed' },
  { id: '0192f1c0-11aa-7e00-8b10-000000000000', period: '10–16 Aug 2026', amount_cents: 297800, entry_count: 139, state: 'PAID', paid_at: '17 Aug 2026' },
];
const CONNECT = { payouts_enabled: true, charges_enabled: true, details_submitted: true, bank_last4: '4821', payout_interval: 'weekly' };

const STAFF = [
  { id: '0191c2d6-3b21-7a10-8c00-7d1e2f3a4b51', full_name: 'Samir Haddad', email: 'samir@zaytoungrill.ca', role: 'RESTAURANT_MANAGER', status: 'ACTIVE', last_login_at: 'Today 17:02' },
  { id: '0191c2d6-3b21-7a10-8c00-7d1e2f3a4b52', full_name: 'Layla Nasser', email: 'layla@zaytoungrill.ca', role: 'RESTAURANT_STAFF', status: 'ACTIVE', last_login_at: 'Today 11:14' },
  { id: '0191c2d6-3b21-7a10-8c00-7d1e2f3a4b53', full_name: 'Yousef Karam', email: 'yousef@zaytoungrill.ca', role: 'RESTAURANT_STAFF', status: 'INVITED', last_login_at: null },
];

/* KycDocument per RestaurantDocType. All four of BUSINESS_LICENCE, HALAL_CERTIFICATE, FOOD_SAFETY
   and OWNER_ID are required; LIABILITY_INSURANCE is optional. The restaurant only uploads; an admin
   transcribes the certificate fields. */
const DOC_TYPES = [
  ['HALAL_CERTIFICATE', 'Halal certificate', true], ['BUSINESS_LICENCE', 'Business licence', true],
  ['FOOD_SAFETY', 'Food safety certificate', true], ['OWNER_ID', 'Owner ID', true], ['LIABILITY_INSURANCE', 'Liability insurance', false],
];
const DOCS = {
  HALAL_CERTIFICATE: { state: 'APPROVED', file: 'halal-certificate-2026.pdf', valid_until: '12 Nov 2026', version: 2 },
  BUSINESS_LICENCE: { state: 'APPROVED', file: 'business-licence.pdf', version: 1 },
  FOOD_SAFETY: { state: 'APPROVED', file: 'dinesafe-2026.pdf', version: 1 },
  OWNER_ID: { state: 'APPROVED', file: 'owner-id.jpg', version: 1 },
  LIABILITY_INSURANCE: null,
};

const DOC_STATE_BADGE = {
  SUBMITTED: ['neutral', 'Submitted'], IN_REVIEW: ['info', 'In review'], APPROVED: ['neutral', 'Approved'],
  REJECTED: ['warning', 'Needs a new upload'], EXPIRED: ['neutral', 'Expired'], SUPERSEDED: ['neutral', 'Superseded'],
};

Object.assign(window, {
  SERVER_TIME, secondsUntil, hhmm, RESTAURANT, AVAILABILITY, ORDERS, REJECT_REASONS, DELAY_REASONS, MENU, HOURS, DAY,
  PAYOUTS, CONNECT, STAFF, DOC_TYPES, DOCS, DOC_STATE_BADGE,
});
