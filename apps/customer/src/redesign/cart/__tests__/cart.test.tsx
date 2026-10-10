/**
 * WP5 C1: the cart against the contract's fixtures (boards `CC/Cart-*`).
 *
 * DONE list (manifest §3 WP5): requests never carry a price (quote, quantity, Undo); the
 * certificate-lapsed cart turns off only + and checkout; below the minimum comes only from
 * `blocking_reasons`; plus priced, estimate, loading, empty, error, offline read only, an order on
 * the way, line updating, removed with Undo, Undo failed, a line at 20, every per-line
 * availability reason, closed, paused, unavailable, clear confirm, "group: variant" options, the
 * stepper's Remove at 1, and dark.
 */
import * as React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { markOffline, resetConnectivity } from '../../lib/connectivity';
import { setNowOverride } from '../../lib/now';
import { quoteKeyFor, rememberCart, rememberQuote, resetCartMemory } from '../../ordering/cart';
import { mockApi, payloadOf, type MockApi } from '../../test/mockApi';
import { navSpy, renderRedesign, type NavSpy } from '../../test/render';
import { CartScreen, OFFLINE_FOOTER } from '../CartScreen';

let mock: MockApi;
let nav: NavSpy;

const MULTI = payloadOf('cart_multi_variant_line');
const MANY = payloadOf('cart_many_lines');

function cartBody(cart: unknown): { status: number; body: unknown } {
  return { status: 200, body: { data: cart } };
}

function withCart(patch: Record<string, unknown>, base = MANY): { status: number; body: unknown } {
  return cartBody({ ...base, ...patch });
}

function lineWith(line: Record<string, unknown>, availability: Record<string, unknown>): Record<string, unknown> {
  return { ...line, availability: { is_available: false, current_price_cents: null, ...availability } };
}

function show(scheme: 'light' | 'dark' = 'light') {
  nav = navSpy({ name: 'cart' });
  return renderRedesign(<CartScreen />, { nav, scheme });
}

function disabled(testID: string): boolean {
  return Boolean(screen.getByTestId(testID).props.accessibilityState?.disabled);
}

function keysOf(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysOf(v, out);
    }
  }
  return out;
}

const MONEY_KEY = /price|subtotal|total|amount|fee|discount|tax/i;

beforeEach(() => {
  resetConnectivity();
  resetCartMemory();
  // 10 Aug 2026, 2:00 pm in Toronto: inside the fixtures' world (quotes expire 2:51 pm).
  setNowOverride({ at: Date.parse('2026-08-10T18:00:00Z') });
  mock = mockApi({
    getCart: 'cart_multi_variant_line',
    listAddresses: 'addresses_list',
    getActiveOrder: 'order_no_active',
    createQuote: 'quote_multi_variant',
    getQuote: 'quote_multi_variant',
    getRestaurantMenu: 'menu_full',
  });
});

afterEach(() => {
  mock.restore();
  setNowOverride(null);
  resetConnectivity();
  resetCartMemory();
});

describe('C1 cart: priced, estimate and the money rows', () => {
  it('priced from createQuote: the same rows as checkout, Service fee always shown; no price in the request', async () => {
    show();
    expect(await screen.findByTestId('Cart-total')).toBeTruthy();
    expect(screen.getByText('Your cart')).toBeTruthy();
    expect(screen.getByText('Items subtotal')).toBeTruthy();
    expect(screen.getByText('Delivery fee')).toBeTruthy();
    expect(screen.getByText('Service fee')).toBeTruthy();
    expect(screen.getByText('HST (13%)')).toBeTruthy();
    expect(screen.getByTestId('Cart-total-price')).toHaveTextContent('$142.86');
    const call = mock.callsTo('createQuote')[0]!;
    expect(call.headers['idempotency-key']).toBeTruthy();
    expect(call.body).toEqual({ cart_id: MULTI.id, fulfilment: 'DELIVERY', delivery_address_id: MULTI.delivery_address_id, tip_cents: 0 });
    // The only money the request carries is the tip, the customer's own choice (zero here).
    expect(keysOf(call.body).filter((k) => MONEY_KEY.test(k))).toEqual([]);
    fireEvent.press(screen.getByTestId('Cart-checkout'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'checkout' } });
  });

  it('a $0.00 service fee is still a row', async () => {
    mock.answer('createQuote', { status: 201, body: { data: { ...payloadOf('quote_multi_variant'), service_fee_cents: 0 } } });
    show();
    expect(await screen.findByTestId('Cart-service-price')).toHaveTextContent('$0.00');
  });

  it('lines render variants[] as "group: variant" joined with " · ", with the line total from the server', async () => {
    show();
    const line = MULTI.lines[0];
    expect(await screen.findByTestId(`CartLine-options-${line.id}`)).toHaveTextContent(
      'Platter size: For two · Rice: No rice · Heat level: Medium · Mint raita × 1',
    );
    expect(screen.getByTestId(`CartLine-total-${line.id}`)).toHaveTextContent('$42.48');
  });

  it('no address: "Items (estimate)", no quote, and the way to choose one', async () => {
    mock.answer('getCart', withCart({ delivery_address_id: null, is_quotable: false }, MULTI));
    show();
    expect(await screen.findByText('Items (estimate)')).toBeTruthy();
    expect(screen.getByText('Add a delivery address')).toBeTruthy();
    expect(screen.getByText('Delivery and fees are priced for your address before you pay.')).toBeTruthy();
    expect(mock.callsTo('createQuote')).toHaveLength(0);
    fireEvent.press(screen.getByText('Choose a delivery address'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'addresses' } });
  });

  it('pricing: rows wait and Go to checkout is busy', async () => {
    mock.answer('createQuote', 'hang');
    show();
    expect(await screen.findByTestId('Cart-pricing')).toHaveTextContent('Pricing your order for your address…');
    expect(screen.getByTestId('Cart-checkout').props.accessibilityState).toMatchObject({ busy: true });
  });

  it('each pricing is its own attempt: a changed cart gets a new Idempotency-Key, even back to the same contents', async () => {
    const line = MULTI.lines[0];
    mock.answer('updateCartLine', [
      cartBody({ ...MULTI, lines: [{ ...line, quantity: 2 }] }),
      cartBody(MULTI),
    ]);
    show();
    await screen.findByTestId('Cart-total');
    fireEvent.press(screen.getByTestId(`CartLine-stepper-${line.id}-increment`));
    await waitFor(() => expect(mock.callsTo('createQuote')).toHaveLength(2));
    await screen.findByTestId('Cart-total');
    fireEvent.press(screen.getByTestId(`CartLine-stepper-${line.id}-increment`));
    await waitFor(() => expect(mock.callsTo('createQuote').length + mock.callsTo('getQuote').length).toBeGreaterThanOrEqual(3));
    const keys = mock.callsTo('createQuote').map((c) => c.headers['idempotency-key']);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('a failed quote: checkout is off; Try again resends the same request with its key', async () => {
    mock.answer('createQuote', [{ status: 503, code: 'SERVICE_UNAVAILABLE' }, 'quote_multi_variant']);
    show();
    expect(await screen.findByTestId('Cart-quoteFailed')).toBeTruthy();
    expect(disabled('Cart-checkout')).toBe(true);
    fireEvent.press(screen.getByTestId('Cart-retryQuote'));
    expect(await screen.findByTestId('Cart-total')).toBeTruthy();
    const [a, b] = mock.callsTo('createQuote');
    expect(b!.headers['idempotency-key']).toBe(a!.headers['idempotency-key']);
    expect(disabled('Cart-checkout')).toBe(false);
  });

  it('a quote past its lifetime is priced again with a new key, and checkout waits for it', async () => {
    show();
    await screen.findByTestId('Cart-total');
    mock.answer('createQuote', 'hang');
    // The quote lives 10 minutes from when it arrived; 11 minutes later it is not a price any more.
    act(() => setNowOverride({ at: Date.parse('2026-08-10T18:11:00Z') }));
    await waitFor(() => expect(mock.callsTo('createQuote')).toHaveLength(2));
    const [a, b] = mock.callsTo('createQuote');
    expect(b!.headers['idempotency-key']).not.toBe(a!.headers['idempotency-key']);
    expect(disabled('Cart-checkout')).toBe(true);
  });

  it('an unexpired quote for the same cart is re-read with getQuote, not priced again', async () => {
    const first = show();
    await screen.findByTestId('Cart-total');
    first.unmount();
    show();
    await screen.findByTestId('Cart-total');
    expect(mock.callsTo('createQuote')).toHaveLength(1);
    expect(mock.callsTo('getQuote')).toHaveLength(1);
  });
});

describe('C1 cart: loading, empty, error, offline', () => {
  it('loading', () => {
    mock.answer('getCart', 'hang');
    show();
    expect(screen.getByText('Loading your cart…')).toBeTruthy();
    expect(disabled('Cart-checkout')).toBe(true);
  });

  it('empty: "Find a restaurant" goes Home', async () => {
    mock.answer('getCart', 'cart_empty');
    show();
    expect(await screen.findByText('Your cart is empty')).toBeTruthy();
    expect(screen.getByText('Add dishes from a certified restaurant to start an order.')).toBeTruthy();
    fireEvent.press(screen.getByText('Find a restaurant'));
    expect(nav.log).toContainEqual({ action: 'open', route: { name: 'home' } });
  });

  it('error: Try again reads again', async () => {
    mock.answer('getCart', [{ status: 500, code: 'INTERNAL_ERROR' }, 'cart_multi_variant_line']);
    show();
    expect(await screen.findByText("We couldn't load your cart")).toBeTruthy();
    expect(screen.getByText('Your items are saved on our side. Check your connection and try again.')).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByTestId('Cart-total')).toBeTruthy();
  });

  it('offline: read only, "as of" the read, nothing queued', async () => {
    show();
    await screen.findByTestId('Cart-total');
    act(() => markOffline());
    expect(screen.getByText("You're offline")).toBeTruthy();
    expect(
      screen.getByText("Showing your cart as of 2:00 pm. You can read it; changing quantities and checking out wait until you're back online."),
    ).toBeTruthy();
    expect(screen.getByTestId('Cart-reason')).toHaveTextContent(OFFLINE_FOOTER);
    expect(disabled('Cart-checkout')).toBe(true);
    const line = MULTI.lines[0];
    expect(disabled(`CartLine-stepper-${line.id}-increment`)).toBe(true);
    expect(screen.queryByTestId(`CartLine-edit-${line.id}`)).toBeNull();
    expect(screen.queryByTestId('Cart-clear')).toBeNull();
  });

  it('offline on arrival: the cart this session already read, as of its time, with its last quote', async () => {
    rememberCart(MULTI, Date.parse('2026-08-10T17:50:00Z'));
    rememberQuote(quoteKeyFor(MULTI, MULTI.delivery_address_id), payloadOf('quote_multi_variant'));
    for (const op of ['getCart', 'listAddresses', 'getActiveOrder']) mock.answer(op, 'offline');
    show();
    expect(await screen.findByText(/Showing your cart as of 1:50 pm\./)).toBeTruthy();
    expect(screen.getByTestId('Cart-halalBadge')).toBeTruthy();
    // The last quote's rows, not the estimate (`CC/Cart-offline`); checkout still waits.
    expect(screen.getByText('Items subtotal')).toBeTruthy();
    expect(screen.getByText('Delivery fee')).toBeTruthy();
    expect(screen.getByText('Service fee')).toBeTruthy();
    expect(screen.getByTestId('Cart-total-price')).toHaveTextContent('$142.86');
    expect(screen.queryByText('Items (estimate)')).toBeNull();
    expect(disabled('Cart-checkout')).toBe(true);
    expect(mock.callsTo('createQuote')).toHaveLength(0);
  });

  it('offline past 15 minutes: the badge goes, the neutral line says why', async () => {
    rememberCart(MULTI, Date.parse('2026-08-10T17:40:00Z'));
    for (const op of ['getCart', 'listAddresses', 'getActiveOrder']) mock.answer(op, 'offline');
    show();
    expect(await screen.findByText("We can't check the certification while you're offline.")).toBeTruthy();
    expect(screen.queryByTestId('Cart-halalBadge')).toBeNull();
  });

  it('renders in dark', async () => {
    show('dark');
    expect(await screen.findByTestId('Cart-total')).toBeTruthy();
    expect(screen.getByTestId('Cart-halalBadge')).toBeTruthy();
  });
});

describe('C1 cart: lines', () => {
  it('line updating: the stepper is busy, the body carries the quantity only', async () => {
    mock.answer('getCart', 'cart_many_lines');
    mock.answer('updateCartLine', 'hang');
    show();
    const line = MANY.lines[1];
    fireEvent.press(await screen.findByTestId(`CartLine-stepper-${line.id}-increment`));
    await waitFor(() => expect(screen.getByTestId(`CartLine-stepper-${line.id}-busy`)).toBeTruthy());
    expect(mock.callsTo('updateCartLine')[0]!.body).toEqual({ quantity: 2 });
  });

  it('at 1 the minus is Remove; removed with Undo re-adds the same line by ids', async () => {
    const line = MULTI.lines[0];
    mock.answer('removeCartLine', cartBody({ ...MULTI, lines: [], item_count: 0, indicative_subtotal_cents: 0 }));
    show();
    const minus = await screen.findByTestId(`CartLine-stepper-${line.id}-decrement`);
    expect(minus.props.accessibilityLabel).toBe(`Remove ${line.name}`);
    fireEvent.press(minus);
    expect(await screen.findByText(`Removed ${line.name}`)).toBeTruthy();
    fireEvent.press(screen.getByText('Undo'));
    expect(await screen.findByTestId(`CartLine-${line.id}`)).toBeTruthy();
    const undo = mock.callsTo('addCartLine')[0]!;
    expect(undo.headers['idempotency-key']).toBeTruthy();
    expect(keysOf(undo.body).filter((k) => MONEY_KEY.test(k))).toEqual([]);
    expect(undo.body).toEqual({
      menu_item_id: line.menu_item_id,
      quantity: 1,
      variant_ids: line.variants.map((v: { variant_id: string }) => v.variant_id),
      addons: [{ addon_id: line.addons[0].addon_id, quantity: 1 }],
    });
  });

  it('a double tap on Undo re-adds the line once, with the key minted at removal', async () => {
    const line = MULTI.lines[0];
    mock.answer('removeCartLine', cartBody({ ...MULTI, lines: [], item_count: 0, indicative_subtotal_cents: 0 }));
    show();
    fireEvent.press(await screen.findByTestId(`CartLine-stepper-${line.id}-decrement`));
    const undo = await screen.findByText('Undo');
    fireEvent.press(undo);
    fireEvent.press(undo);
    expect(await screen.findByTestId(`CartLine-${line.id}`)).toBeTruthy();
    expect(mock.callsTo('addCartLine')).toHaveLength(1);
  });

  it('Undo failed: a warning says why and the cart stays as it is', async () => {
    const line = MULTI.lines[0];
    mock.answer('removeCartLine', cartBody({ ...MULTI, lines: [], item_count: 0, indicative_subtotal_cents: 0 }));
    mock.answer('addCartLine', { status: 409, code: 'VARIANT_UNAVAILABLE', details: { variant_id: line.variants[0].variant_id } });
    show();
    fireEvent.press(await screen.findByTestId(`CartLine-stepper-${line.id}-decrement`));
    fireEvent.press(await screen.findByText('Undo'));
    expect(await screen.findByText("Couldn't put it back")).toBeTruthy();
    expect(screen.getByText(`${line.name} just sold out, so it can't be re-added.`)).toBeTruthy();
    expect(screen.getByText('Your cart is empty')).toBeTruthy();
  });

  it('a line at 20: + is off with "Maximum 20"', async () => {
    mock.answer('getCart', 'cart_at_quantity_cap');
    show();
    const line = payloadOf('cart_at_quantity_cap').lines[0];
    expect(await screen.findByTestId(`CartLine-max-${line.id}`)).toHaveTextContent('Maximum 20');
    expect(disabled(`CartLine-stepper-${line.id}-increment`)).toBe(true);
  });

  it('a failed change keeps the cart and says so', async () => {
    mock.answer('getCart', 'cart_many_lines');
    mock.answer('updateCartLine', { status: 500, code: 'INTERNAL_ERROR' });
    show();
    fireEvent.press(await screen.findByTestId(`CartLine-stepper-${MANY.lines[1].id}-increment`));
    expect(await screen.findByText("That change didn't go through")).toBeTruthy();
  });

  it('OUT_OF_STOCK: badge, Remove, and the one-tap remove in the footer', async () => {
    mock.answer('getCart', 'cart_has_unavailable_items');
    mock.answer('removeCartLine', cartBody(MULTI));
    show();
    const nihari = payloadOf('cart_has_unavailable_items').lines[1];
    expect(await screen.findByText('1 item is out of stock')).toBeTruthy();
    expect(screen.getByTestId(`CartLine-flag-${nihari.id}`)).toHaveTextContent('Out of stock');
    expect(screen.getByTestId('Cart-reason')).toHaveTextContent('Beef Nihari is out of stock. Remove it to check out.');
    expect(screen.getByText('Items (estimate)')).toBeTruthy();
    fireEvent.press(screen.getByText('Remove Beef Nihari'));
    await waitFor(() => expect(mock.callsTo('removeCartLine')).toHaveLength(1));
    expect(mock.callsTo('removeCartLine')[0]!.url).toContain(nihari.id);
  });

  it('PRICE_CHANGED: was and now, both server values', async () => {
    const karahi = payloadOf('cart_has_unavailable_items').lines[2];
    mock.answer('getCart', withCart({ lines: [{ ...karahi, availability: { ...karahi.availability, is_available: true } }], blocking_reasons: [] }));
    show();
    expect(await screen.findByText('A price changed')).toBeTruthy();
    expect(screen.getByText('Chicken Karahi (Half) now costs more. The total below uses the new price, or you can remove it.')).toBeTruthy();
    expect(screen.getByTestId(`CartLine-was-${karahi.id}`)).toHaveTextContent('$18.99');
    expect(screen.getByTestId(`CartLine-now-${karahi.id}`)).toHaveTextContent('$20.99');
  });

  it('VARIANT_UNAVAILABLE: "Size sold out", Edit and Remove, checkout off', async () => {
    const line = MULTI.lines[0];
    mock.answer('getCart', withCart({ lines: [lineWith(line, { reason: 'VARIANT_UNAVAILABLE' })], is_quotable: false, blocking_reasons: ['CART_HAS_UNAVAILABLE_ITEMS'] }, MULTI));
    show();
    expect(await screen.findByText('The size you chose is sold out')).toBeTruthy();
    expect(screen.getByTestId(`CartLine-flag-${line.id}`)).toHaveTextContent('Size sold out');
    expect(screen.getByTestId(`CartLine-remove-${line.id}`)).toBeTruthy();
    expect(screen.getByTestId('Cart-reason')).toHaveTextContent('Pick another size or remove the item to check out.');
    expect(disabled('Cart-checkout')).toBe(true);
    fireEvent.press(screen.getByTestId(`CartLine-edit-${line.id}`));
    expect(await screen.findByText('Update item')).toBeTruthy();
  });

  it('ADDON_UNAVAILABLE: "Extra ran out", and the extra is marked "(ran out)"', async () => {
    const line = MULTI.lines[0];
    mock.answer('getCart', withCart({ lines: [lineWith(line, { reason: 'ADDON_UNAVAILABLE' })], is_quotable: false }, MULTI));
    show();
    expect(await screen.findByText('An extra you chose has run out')).toBeTruthy();
    expect(screen.getByTestId(`CartLine-flag-${line.id}`)).toHaveTextContent('Extra ran out');
    expect(screen.getByTestId(`CartLine-options-${line.id}`)).toHaveTextContent(/Mint raita × 1 \(ran out\)$/);
    expect(screen.getByTestId('Cart-reason')).toHaveTextContent('Change or remove the item with the extra that ran out to check out.');
  });

  it('ITEM_DELETED and CATEGORY_INACTIVE: no Edit, "Remove 2 items"', async () => {
    const [a, b] = MANY.lines;
    mock.answer('getCart', withCart({ lines: [lineWith(a, { reason: 'ITEM_DELETED' }), lineWith(b, { reason: 'CATEGORY_INACTIVE' })], is_quotable: false }));
    show();
    expect(await screen.findByText("2 items can't be ordered right now")).toBeTruthy();
    expect(
      screen.getByText(
        "One is no longer on the menu and one isn't available right now. Remove them to continue — we don't change your cart without asking.",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId(`CartLine-flag-${a.id}`)).toHaveTextContent('No longer on the menu');
    expect(screen.getByTestId(`CartLine-flag-${b.id}`)).toHaveTextContent('Not available right now');
    expect(screen.queryByTestId(`CartLine-edit-${a.id}`)).toBeNull();
    expect(screen.getByText('Remove 2 items')).toBeTruthy();
  });
});

describe('C1 cart: the restaurant and the order', () => {
  it('an order already on the way: banner, and "View order" opens tracking', async () => {
    mock.answer('getActiveOrder', 'order_preparing');
    show();
    expect(await screen.findByText('You already have an order on the way')).toBeTruthy();
    expect(screen.getByText("Order HG-4K2M-9T from Karachi Kitchen is being prepared. You can place another once it's delivered.")).toBeTruthy();
    expect(screen.getByTestId('Cart-reason')).toHaveTextContent('You can check out once your current order is delivered. Your cart is saved.');
    expect(screen.queryByTestId('Cart-checkout')).toBeNull();
    fireEvent.press(screen.getByText('View order'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'tracking', orderId: payloadOf('order_preparing').id } });
  });

  it('closed: banner with the opening time, checkout waits', async () => {
    mock.answer('getCart', withCart({ restaurant: { ...MULTI.restaurant, availability: payloadOf('restaurant_availability_closed_hours') }, is_quotable: false }, MULTI));
    show();
    expect(await screen.findByText("Karachi Kitchen isn't taking orders right now")).toBeTruthy();
    expect(screen.getByTestId('Cart-reason')).toHaveTextContent('Checkout opens when the restaurant does.');
    expect(disabled('Cart-checkout')).toBe(true);
    fireEvent.press(screen.getByText('Find an open restaurant'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'browse', openNow: true } });
  });

  it('paused: the kitchen has paused new orders', async () => {
    mock.answer('getCart', withCart({ restaurant: { ...MULTI.restaurant, availability: payloadOf('restaurant_availability_paused') }, is_quotable: false }, MULTI));
    show();
    expect(await screen.findByText('The kitchen has paused new orders. Your cart is saved, and you can check out when it reopens.')).toBeTruthy();
  });

  it('restaurant unavailable: no badge and no halal cause', async () => {
    mock.answer('getCart', withCart({ restaurant: null, is_quotable: false, blocking_reasons: ['RESTAURANT_UNAVAILABLE'] }, MULTI));
    show();
    expect(await screen.findByText("This restaurant can't take orders right now")).toBeTruthy();
    expect(screen.queryByTestId('Cart-halalBadge')).toBeNull();
    expect(screen.queryByText(/halal/i)).toBeNull();
    expect(screen.getByTestId('Cart-reason')).toHaveTextContent('Checkout is off while this restaurant is unavailable.');
    expect(screen.getByText('Find another restaurant')).toBeTruthy();
  });

  it('certification lapsed (EXPIRED): slate seal and banner; only + and checkout turn off', async () => {
    mock.answer('getCart', 'cart_restaurant_unavailable');
    show();
    const line = payloadOf('cart_restaurant_unavailable').lines[0];
    expect(
      await screen.findByText(
        "Karachi Kitchen's halal certificate isn't current, so we can't take this order. If the certificate is renewed, your cart will be here.",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('Cart-halalBadge')).toBeTruthy();
    // Only + is off; − stays on (it is a Remove only at 1).
    expect(disabled(`CartLine-stepper-${line.id}-increment`)).toBe(true);
    expect(disabled(`CartLine-stepper-${line.id}-decrement`)).toBe(false);
    // Checkout is gone; the way forward and Clear cart stay.
    expect(screen.queryByTestId('Cart-checkout')).toBeNull();
    expect(screen.getByText('Find another restaurant')).toBeTruthy();
    expect(screen.getByTestId('Cart-clear')).toBeTruthy();
    expect(mock.callsTo('createQuote')).toHaveLength(0);
  });

  it('certification lapsed, offline past 15 minutes: presentHalal drops the seal for the offline line', async () => {
    const lapsed = payloadOf('cart_restaurant_unavailable');
    rememberCart(lapsed, Date.parse('2026-08-10T17:40:00Z'));
    for (const op of ['getCart', 'listAddresses', 'getActiveOrder']) mock.answer(op, 'offline');
    show();
    expect(await screen.findByText("We can't check the certification while you're offline.")).toBeTruthy();
    expect(screen.queryByTestId('Cart-halalBadge')).toBeNull();
    expect(screen.getByTestId('Cart-certLapsed')).toBeTruthy();
  });

  it('below the minimum, from blocking_reasons: banner with the server minimum and "Add more items"', async () => {
    mock.answer('getCart', 'cart_single_line');
    show();
    expect(await screen.findByText('Below the minimum order')).toBeTruthy();
    expect(screen.getByText("Karachi Kitchen's minimum order is $15.00. Add more items to check out.")).toBeTruthy();
    fireEvent.press(screen.getByText('Add more items'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'restaurant', restaurantId: MULTI.restaurant.id } });
  });

  it('below the minimum is never a client comparison: no BELOW_MINIMUM_ORDER, no banner', async () => {
    mock.answer('getCart', withCart({ indicative_subtotal_cents: 100, blocking_reasons: [], is_quotable: true }, payloadOf('cart_single_line')));
    show();
    expect(await screen.findByTestId('Cart-total')).toBeTruthy();
    expect(screen.queryByText('Below the minimum order')).toBeNull();
  });

  it('a quote refused BELOW_MINIMUM_ORDER shows the same board', async () => {
    mock.answer('createQuote', { status: 409, code: 'BELOW_MINIMUM_ORDER' });
    show();
    expect(await screen.findByText('Below the minimum order')).toBeTruthy();
  });

  it('clear cart: confirm first, then the empty cart', async () => {
    mock.answer('clearCart', { status: 204, body: null });
    show();
    fireEvent.press(await screen.findByTestId('Cart-clear'));
    const dialog = await screen.findByTestId('Cart-clearDialog');
    expect(within(dialog).getByText('Clear your cart?')).toBeTruthy();
    expect(within(dialog).getByText("This removes all 1 item from Karachi Kitchen. You can't undo this.")).toBeTruthy();
    mock.answer('getCart', 'cart_empty');
    fireEvent.press(screen.getByTestId('Cart-confirmClear'));
    expect(await screen.findByText('Your cart is empty')).toBeTruthy();
    expect(mock.callsTo('clearCart')).toHaveLength(1);
  });
});
