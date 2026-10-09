/* Sample payloads for the customer kit, shaped like contracts/openapi.yaml responses.
   Every amount is a *_cents field the server returned. The kit never adds, multiplies or
   rounds money: it only formats what is here (invariant 1, "the server prices every order").
   Ids are UUIDv7-shaped (format: uuid); humans see OrderSummary.code. Images: every
   *_image_url is null because no photography exists yet, which is also a real API state. */

const ADDRESSES = [
  { id: '01926f3a-7c1e-7b2a-9d4e-3f1a2b3c4d5e', label: 'Home', line1: '14 Ellesmere Rd', unit: '402', buzzer: '402', city: 'Toronto', province: 'ON', postal_code: 'M1R 4E7', delivery_notes: 'Leave at the door', is_default: true },
  { id: '01926f3a-8a02-7c11-a0f3-5b6c7d8e9f01', label: 'Work', line1: '2075 Kennedy Rd', unit: null, buzzer: null, city: 'Toronto', province: 'ON', postal_code: 'M1T 3V3', delivery_notes: null, is_default: false },
];

const R_ZAYTOUN = {
  id: '01926f3b-0d4c-7e55-8b21-9a0c1d2e3f40', name: 'Zaytoun Grill', slug: 'zaytoun-grill',
  hero_image_url: null, logo_image_url: null, cuisines: ['Levantine', 'Grill'], rating_avg: 4.8, rating_count: 212, price_band: '$$',
  halal: { display_state: 'CERTIFIED', certifying_body_name: 'Halal Monitoring Authority (HMA Canada)', expires_on: '2027-03-31' },
  availability: { state: 'OPEN', eta_min_minutes: 25, eta_max_minutes: 35, opens_at: null, distance_m: 1800 },
};
const R_KARAHI = {
  id: '01926f3b-1e5d-7f66-9c32-ab1d2e3f4051', name: 'Karahi House', slug: 'karahi-house',
  hero_image_url: null, logo_image_url: null, cuisines: ['Pakistani'], rating_avg: 4.6, rating_count: 486, price_band: '$$',
  halal: { display_state: 'EXPIRING_SOON', certifying_body_name: 'Islamic Society of North America Canada (ISNA Canada)', expires_on: '2026-11-12' },
  availability: { state: 'OPEN', eta_min_minutes: 30, eta_max_minutes: 45, opens_at: null, distance_m: 3100 },
};
const R_ANATOLIA = {
  id: '01926f3b-2f6e-7a77-8d43-bc2e3f405162', name: 'Anatolia Doner', slug: 'anatolia-doner',
  hero_image_url: null, logo_image_url: null, cuisines: ['Turkish'], rating_avg: null, rating_count: 0, price_band: '$',
  halal: { display_state: 'CERTIFIED', certifying_body_name: 'Halal Food Standards Alliance of America (HFSAA)', expires_on: '2027-01-15' },
  availability: { state: 'CLOSED_HOURS', eta_min_minutes: null, eta_max_minutes: null, opens_at: 'Tomorrow 11:00', distance_m: 2400 },
};
/* A card whose payload arrived WITHOUT the halal object: the client renders no badge (invariant 8, C-12 R4). */
const R_NOHALAL = {
  id: '01926f3b-3a7f-7b88-9e54-cd3f40516273', name: 'Bait Al Mandi', slug: 'bait-al-mandi',
  hero_image_url: null, logo_image_url: null, cuisines: ['Yemeni'], rating_avg: 4.4, rating_count: 61, price_band: '$$',
  halal: null,
  availability: { state: 'OPEN', eta_min_minutes: 35, eta_max_minutes: 50, opens_at: null, distance_m: 4200 },
};

/* GET /v1/feed → FeedSection[] */
const FEED = [
  { key: 'open_near_you', title: 'Open near you', restaurants: [R_ZAYTOUN, R_KARAHI, R_NOHALAL] },
  { key: 'opening_later', title: 'Opening later', restaurants: [R_ANATOLIA] },
];

/* GET /v1/restaurants/{id}/menu → categories with items */
const MENU = [
  { id: '01926f3c-0001-7000-8000-000000000001', name: 'Charcoal grills', items: [
    { id: '01926f3c-1001-7a00-8000-0000000000a1', name: 'Mixed charcoal grill', description: 'Chicken shish, kofta, lamb cube, garlic sauce, two breads', image_url: null, price_cents: 2499, availability_state: 'AVAILABLE', out_of_stock_until: null,
      dietary_tags: [], allergen_tags: ['WHEAT_TRITICALE', 'SESAME', 'EGGS'], ingredients_text: 'Chicken, beef, lamb, garlic, oil, flatbread',
      variant_groups: [{ id: 'vg1', name: 'Size', required: true, variants: [
        { id: 'v1', name: 'For one', pricing_mode: 'ABSOLUTE', price_cents: 2499, is_default: false, is_available: true },
        { id: 'v2', name: 'For two', pricing_mode: 'ABSOLUTE', price_cents: 3999, is_default: false, is_available: true }] }],
      addon_groups: [{ id: 'ag1', name: 'Extras', min_select: 0, max_select: 2, addons: [
        { id: 'a1', name: 'Extra garlic sauce', price_cents: 150, is_available: true },
        { id: 'a2', name: 'Pickled turnips', price_cents: 100, is_available: true },
        { id: 'a3', name: 'Extra bread', price_cents: 150, is_available: false }] }] },
    { id: '01926f3c-1002-7a00-8000-0000000000a2', name: 'Adana kebab', description: 'Hand-minced lamb, sumac onion, ezme', image_url: null, price_cents: 2199, availability_state: 'OUT_OF_STOCK', out_of_stock_until: '19:30',
      dietary_tags: ['SPICY'], allergen_tags: [], variant_groups: [], addon_groups: [] },
  ] },
  { id: '01926f3c-0001-7000-8000-000000000002', name: 'Wraps', items: [
    { id: '01926f3c-1003-7a00-8000-0000000000a3', name: 'Chicken shawarma wrap', description: 'Shaved chicken, pickles, toum, saj bread', image_url: null, price_cents: 1249, availability_state: 'AVAILABLE', out_of_stock_until: null,
      dietary_tags: [], allergen_tags: [], variant_groups: [], addon_groups: [] },
    { id: '01926f3c-1004-7a00-8000-0000000000a4', name: 'Falafel wrap', description: 'Falafel, tahini, parsley, tomato', image_url: null, price_cents: 1099, availability_state: 'AVAILABLE', out_of_stock_until: null,
      dietary_tags: ['VEGETARIAN', 'VEGAN'], allergen_tags: ['SESAME', 'WHEAT_TRITICALE'], variant_groups: [], addon_groups: [] },
  ] },
];

/* GET /v1/restaurants/{id} certification → CertificationPanel, passed to HalalCertificationPanel unchanged.
   Dates are wire dates; the component renders them absolutely. */
const CERT_PANEL = {
  display_state: 'CERTIFIED', certifying_body_name: 'Halal Monitoring Authority (HMA Canada)', certificate_number: 'HMA-ON-24-0183 (sample, transcribed)',
  scope: 'WHOLE_ESTABLISHMENT', issued_on: '2026-04-01', expires_on: '2027-03-31', verified_at: '2026-09-04T14:02:00Z', certificate_viewable: true,
  disclaimer: 'Certification verified by HalalGoes on the date shown on each listing. HalalGoes does not itself certify food.',
};

/* The server clock at response time, for Countdown (serverNow). */
const SERVER_NOW = '2026-09-28T18:43:30-04:00';

/* GET /v1/cart → Cart (line totals are the server's) */
const CART = {
  id: '01926f3d-0a1b-7c2d-8e3f-405162738495', restaurant: R_ZAYTOUN, delivery_address_id: ADDRESSES[0].id, item_count: 3, indicative_subtotal_cents: 4997, currency: 'CAD', is_quotable: true,
  lines: [
    { id: 'l1', menu_item_id: 'm1', name: 'Mixed charcoal grill', variant: { name: 'For one' }, addons: [{ name: 'Extra garlic sauce' }], quantity: 1, special_request: 'No onions please', unit_price_cents: 2649, line_total_cents: 2649, image_url: null, availability: { is_available: true } },
    { id: 'l2', menu_item_id: 'm3', name: 'Chicken shawarma wrap', variant: null, addons: [], quantity: 2, special_request: null, unit_price_cents: 1174, line_total_cents: 2348, image_url: null, availability: { is_available: true } },
  ],
};
const CART_UNAVAILABLE = { ...CART, is_quotable: false, lines: [
  CART.lines[0],
  { ...CART.lines[1], availability: { is_available: false, reason: 'OUT_OF_STOCK', current_price_cents: null } },
] };

/* POST /v1/quotes → Quote. tax_lines is empty while O-01 (HST registration) is open. */
const QUOTE = {
  id: '01926f3e-4b5c-7d6e-8f70-8192a3b4c5d6', currency: 'CAD', subtotal_cents: 4997, discount_items_cents: 0, discount_delivery_cents: 0, discount_service_cents: 0,
  delivery_fee_cents: 479, service_fee_cents: 0, tax_lines: [], tax_total_cents: 0, tip_cents: 750, total_cents: 6226, expires_at: '18:57', billable_km: 2,
};
/* The same quote once O-01 closes: the label comes from tax_lines[].statutory_label, the amount from the server. */
const QUOTE_TAXED = { ...QUOTE, tax_lines: [{ statutory_label: 'HST', rate: '0.13000000', amount_cents: 712 }], tax_total_cents: 712, total_cents: 6938 };

const PAYMENT_METHODS = [
  { id: 'pm_1', brand: 'Visa', last4: '4242', exp_month: 8, exp_year: 2028, is_default: true },
  { id: 'pm_2', brand: 'Mastercard', last4: '5100', exp_month: 2, exp_year: 2027, is_default: false },
];

const RIDER = { first_name: 'Yusuf', last_initial: 'A', photo_url: null, vehicle_type: 'BICYCLE', rating_avg: 4.9 };

/* GET /v1/orders → OrderSummary[] */
const ORDERS_ACTIVE = [
  { id: '01926f40-1a2b-7c3d-8e4f-5a6b7c8d9e0f', code: 'A7Q2', state: 'PREPARING', restaurant: { name: 'Zaytoun Grill', halal: R_ZAYTOUN.halal }, item_count: 3, first_item_names: ['Mixed charcoal grill', 'Chicken shawarma wrap'], total_cents: 6226, placed_at: 'Today 18:42' },
];
const ORDERS_PAST = [
  { id: '01926e11-2b3c-7d4e-8f50-6b7c8d9e0f1a', code: 'K3M8', state: 'COMPLETED', restaurant: { name: 'Karahi House', halal: R_KARAHI.halal }, item_count: 2, first_item_names: ['Chicken karahi', 'Garlic naan'], total_cents: 4410, placed_at: 'Fri 19:05' },
  { id: '01926d02-3c4d-7e5f-8061-7c8d9e0f1a2b', code: 'P9T4', state: 'REJECTED', restaurant: { name: 'Anatolia Doner', halal: R_ANATOLIA.halal }, item_count: 1, first_item_names: ['Doner plate'], total_cents: 2380, placed_at: 'Wed 12:31' },
  { id: '01926c93-4d5e-7f60-8172-8d9e0f1a2b3c', code: 'R2D6', state: 'RESOLVED', restaurant: { name: 'Zaytoun Grill', halal: R_ZAYTOUN.halal }, item_count: 4, first_item_names: ['Falafel wrap', 'Mint lemonade'], total_cents: 5120, placed_at: '12 Sept' },
];

/* GET /v1/notifications */
const NOTIFICATIONS = [
  { id: 'n1', kind: 'ORDER_STATE', title: 'Your order is being prepared', body: 'Zaytoun Grill accepted order A7Q2 at 18:44.', created_at: '18:44', read_at: null, priority: 'HIGH' },
  { id: 'n2', kind: 'ORDER_STATE', title: 'Order K3M8 delivered', body: 'Rate your order from Karahi House.', created_at: 'Fri', read_at: 'Fri', priority: 'NORMAL' },
  { id: 'n3', kind: 'REFUND', title: 'Order R2D6 resolved', body: 'Support closed your report. See the outcome on the order.', created_at: '13 Sept', read_at: '13 Sept', priority: 'NORMAL' },
];

Object.assign(window, { ADDRESSES, R_ZAYTOUN, R_KARAHI, R_ANATOLIA, R_NOHALAL, FEED, MENU, CERT_PANEL, CART, CART_UNAVAILABLE, QUOTE, QUOTE_TAXED, PAYMENT_METHODS, RIDER, SERVER_NOW, ORDERS_ACTIVE, ORDERS_PAST, NOTIFICATIONS });
