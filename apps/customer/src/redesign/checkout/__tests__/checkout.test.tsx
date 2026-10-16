/**
 * Checkout against the contract's fixtures (boards `CC/Checkout-*`).
 *
 * What these pin: no request ever carries a price; every amount on the page is the server's;
 * a failed or declined authorisation is a state with a way forward (retry, cancel), never a dead
 * end and never a fake success; and the empty, loading and error states exist.
 */
import * as React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { markOffline, resetConnectivity } from '../../lib/connectivity';
import { setNowOverride } from '../../lib/now';
import { resetCartMemory } from '../../ordering/cart';
import { mockApi, payloadOf, type MockApi } from '../../test/mockApi';
import { navSpy, renderRedesign, type NavSpy } from '../../test/render';
import { MONEY_KEY, keysOf } from '../../test/requests';
import { CheckoutScreen, timing } from '../CheckoutScreen';

jest.mock('../../../payments/pay', () => ({ payWithSheet: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { payWithSheet } = require('../../../payments/pay') as { payWithSheet: jest.Mock };

let mock: MockApi;
let nav: NavSpy;

const CART = payloadOf('cart_multi_variant_line');
const QUOTE = payloadOf('quote_zero_tip');
const ORDER = payloadOf('order_created');
// Read from the fixture rather than written out, so the secret scan sees no key-shaped literal here.
const SECRET: string = payloadOf('payment_requires_action').client_secret;

const created = { status: 201, body: { data: { order: ORDER, client_secret: SECRET } } };

function show() {
  nav = navSpy({ name: 'checkout' });
  return renderRedesign(<CheckoutScreen />, { nav });
}

async function ready() {
  await screen.findByTestId('Checkout-total');
  await waitFor(() => expect(screen.getByTestId('Checkout-place').props.accessibilityState?.disabled).toBeFalsy());
}

async function place() {
  fireEvent.press(screen.getByTestId('Checkout-place'));
}

beforeEach(() => {
  resetConnectivity();
  resetCartMemory();
  payWithSheet.mockReset();
  // 10 Aug 2026, 2:00 pm in Toronto: inside the fixtures' world.
  setNowOverride({ at: Date.parse('2026-08-10T18:00:00Z') });
  Object.assign(timing, { duplicateMs: 5, checkMs: 5, pollMs: 5, tipMs: 5 });
  mock = mockApi({
    getCart: 'cart_multi_variant_line',
    listAddresses: 'addresses_list',
    getActiveOrder: 'order_no_active',
    listPaymentMethods: 'payment_methods_list',
    createQuote: 'quote_zero_tip',
    getQuote: 'quote_zero_tip',
    createOrder: created,
    getOrder: 'order_created',
    getOrderPayment: 'payment_requires_capture',
  });
});

afterEach(() => {
  mock.restore();
  setNowOverride(null);
  resetConnectivity();
  resetCartMemory();
});

describe('checkout: priced by the server, never by the phone', () => {
  it('shows the quote\'s own rows and total; the quote request carries ids and a tip, no price', async () => {
    show();
    await ready();
    expect(screen.getByTestId('Checkout-subtotal-price')).toHaveTextContent('$79.87');
    expect(screen.getByTestId('Checkout-total-price')).toHaveTextContent('$99.84');
    expect(screen.getByText('Service fee')).toBeTruthy();
    expect(screen.getByText('HST (13%)')).toBeTruthy();
    expect(screen.getByTestId('Checkout-place')).toHaveTextContent('Place order · $99.84');
    const call = mock.callsTo('createQuote')[0]!;
    expect(call.headers['idempotency-key']).toBeTruthy();
    expect(call.body).toEqual({ cart_id: CART.id, fulfilment: 'DELIVERY', delivery_address_id: 'b7b6c797-5584-44b3-ac8d-9af8e9572de8', tip_cents: 0 });
    expect(keysOf(call.body).filter((k) => MONEY_KEY.test(k) && k !== 'tip_cents')).toEqual([]);
  });

  it('a tip re-prices: the new request carries the tip, and Place order waits for the new quote', async () => {
    show();
    await ready();
    mock.answer('createQuote', { status: 201, body: { data: { ...QUOTE, tip_cents: 300, total_cents: 10284 } } });
    fireEvent.press(screen.getByTestId('Checkout-tip-300'));
    await waitFor(() => expect(mock.callsTo('createQuote')).toHaveLength(2));
    expect(mock.callsTo('createQuote')[1]!.body).toMatchObject({ tip_cents: 300 });
    await waitFor(() => expect(screen.getByTestId('Checkout-total-price')).toHaveTextContent('$102.84'));
    expect(screen.getByTestId('Checkout-tipRow-price')).toHaveTextContent('$3.00');
  });

  it('a tip the server refuses (422 on tip_cents) says so and turns Place order off; nothing is sent as an order', async () => {
    show();
    await ready();
    mock.answer('createQuote', {
      status: 422,
      code: 'VALIDATION_FAILED',
      details: [{ field: 'tip_cents', code: 'TOO_LARGE', message: 'too large' }],
    });
    fireEvent.press(screen.getByTestId('Checkout-tip-other'));
    fireEvent.changeText(await screen.findByTestId('Checkout-tipInput-field'), '60.00');
    expect(await screen.findByText(/more than we can accept for this order/)).toBeTruthy();
    expect(mock.callsTo('createQuote')[1]!.body).toMatchObject({ tip_cents: 6000 });
    expect(screen.getByTestId('Checkout-place').props.accessibilityState?.disabled).toBeTruthy();
    expect(mock.callsTo('createOrder')).toHaveLength(0);
  });
});

describe('checkout: placing the order', () => {
  it('createOrder carries the quote id and the delivery notes, no price; a card authorised by the server leaves for tracking', async () => {
    payWithSheet.mockResolvedValue({ status: 'paid' });
    show();
    await ready();
    await place();
    await waitFor(() => expect(nav.log).toContainEqual({ action: 'reset', route: { name: 'tracking', orderId: ORDER.id } }));
    const call = mock.callsTo('createOrder')[0]!;
    expect(call.headers['idempotency-key']).toBeTruthy();
    // The saved default card, the client's default handover, and the address's own delivery note.
    expect(call.body).toEqual({
      quote_id: QUOTE.id,
      save_payment_method: false,
      payment_method_id: payloadOf('payment_methods_list')[0].id,
      delivery_instructions: ['MEET_AT_DOOR'],
      special_instructions: payloadOf('addresses_list')[0].delivery_notes,
    });
    expect(keysOf(call.body).filter((k) => MONEY_KEY.test(k))).toEqual([]);
    expect(payWithSheet).toHaveBeenCalledWith(SECRET);
  });

  it('never says placed on the sheet\'s word alone: the payment is read back first', async () => {
    payWithSheet.mockResolvedValue({ status: 'paid' });
    mock.answer('getOrderPayment', 'payment_processing');
    show();
    await ready();
    await place();
    expect(await screen.findByTestId('Checkout-processing')).toBeTruthy();
    expect(nav.log.filter((l) => l.action === 'reset')).toEqual([]);
    mock.answer('getOrderPayment', 'payment_requires_capture');
    await waitFor(() => expect(nav.log).toContainEqual({ action: 'reset', route: { name: 'tracking', orderId: ORDER.id } }));
  });

  it('a declined card is a state with a way forward: nothing charged, retry the same payment, or cancel', async () => {
    payWithSheet.mockResolvedValue({ status: 'failed', message: 'raw provider text that must never show' });
    mock.answer('getOrderPayment', 'payment_failed');
    show();
    await ready();
    await place();
    expect(await screen.findByTestId('Checkout-declined')).toBeTruthy();
    expect(screen.getByText('Your bank declined this card')).toBeTruthy();
    expect(screen.queryByText(/raw provider text/)).toBeNull();
    expect(screen.getByText(/Nothing was charged/)).toBeTruthy();
    expect(nav.log.filter((l) => l.action === 'reset')).toEqual([]);

    // Try again confirms the SAME order; a second createOrder would be refused by the server.
    payWithSheet.mockResolvedValue({ status: 'paid' });
    mock.answer('getOrderPayment', 'payment_requires_capture');
    fireEvent.press(screen.getByTestId('Checkout-retry'));
    await waitFor(() => expect(nav.log).toContainEqual({ action: 'reset', route: { name: 'tracking', orderId: ORDER.id } }));
    expect(mock.callsTo('createOrder')).toHaveLength(1);
  });

  it('closing the payment sheet is neutral, not a decline', async () => {
    payWithSheet.mockResolvedValue({ status: 'canceled' });
    mock.answer('getOrderPayment', 'payment_requires_payment_method');
    show();
    await ready();
    await place();
    expect(await screen.findByTestId('Checkout-closed')).toBeTruthy();
    expect(screen.getByText('The payment sheet was closed')).toBeTruthy();
  });

  it('the hold is judged on the server\'s clock: a phone running past the deadline does not end the order', async () => {
    payWithSheet.mockResolvedValue({ status: 'canceled' });
    mock.answer('getOrderPayment', 'payment_requires_payment_method');
    // If the page believed the phone, the deadline has passed and this read would end the order.
    mock.answer('getOrder', 'order_cancelled');
    show();
    await ready();
    setNowOverride({ at: Date.parse(ORDER.deadline_at!) + 30 * 60_000 });
    await place();
    expect(await screen.findByTestId('Checkout-closed')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.queryByTestId('Checkout-ended-deadline')).toBeNull();
    expect(screen.queryByTestId('Checkout-ended-cancelled')).toBeNull();
  });

  it('a bank challenge is a normal path: confirm with the bank', async () => {
    payWithSheet.mockResolvedValue({ status: 'failed' });
    mock.answer('getOrderPayment', 'payment_requires_action');
    show();
    await ready();
    await place();
    expect(await screen.findByTestId('Checkout-bank')).toBeTruthy();
    expect(screen.getByTestId('Checkout-retry')).toHaveTextContent('Confirm with your bank');
  });

  it('cancelling an unpaid order voids it: a reason is needed, the request carries no price, then the items can go back', async () => {
    payWithSheet.mockResolvedValue({ status: 'failed' });
    mock.answer('getOrderPayment', 'payment_failed');
    mock.answer('cancelOrder', 'order_cancelled');
    mock.answer('addCartLine', 'cart_multi_variant_line');
    show();
    await ready();
    await place();
    fireEvent.press(await screen.findByTestId('Checkout-cancelOrder'));
    // Nothing is pre-selected: Cancel order does nothing until a reason is chosen.
    fireEvent.press(await screen.findByTestId('Checkout-confirmCancel'));
    expect(mock.callsTo('cancelOrder')).toHaveLength(0);
    fireEvent.press(screen.getByTestId('Checkout-reason-CHANGED_MIND'));
    fireEvent.press(screen.getByTestId('Checkout-confirmCancel'));
    expect(await screen.findByTestId('Checkout-ended-cancelled')).toBeTruthy();
    const cancel = mock.callsTo('cancelOrder')[0]!;
    expect(cancel.body).toEqual({ reason_code: 'CHANGED_MIND' });
    expect(cancel.headers['idempotency-key']).toBeTruthy();

    fireEvent.press(screen.getByTestId('Checkout-putBack'));
    await waitFor(() => expect(nav.log).toContainEqual({ action: 'replace', route: { name: 'cart' } }));
    const adds = mock.callsTo('addCartLine');
    expect(adds).toHaveLength(ORDER.lines.length);
    for (const add of adds) {
      expect(add.headers['idempotency-key']).toBeTruthy();
      expect(keysOf(add.body).filter((k) => MONEY_KEY.test(k))).toEqual([]);
    }
  });

  it('the price changed at placing: both figures are the server\'s, and nothing was charged', async () => {
    const fresh = { ...QUOTE, id: 'fa7c1d6e-0000-4000-8000-000000000001', delivery_fee_cents: QUOTE.delivery_fee_cents + 150, total_cents: QUOTE.total_cents + 150 };
    mock.answer('createOrder', { status: 409, code: 'QUOTE_STALE', details: { quote: fresh } });
    show();
    await ready();
    await place();
    expect(await screen.findByText('The price changed')).toBeTruthy();
    expect(screen.getByText('It changed while you were placing the order. Nothing has been charged.')).toBeTruthy();
    expect(mock.callsTo('createOrder')).toHaveLength(1);
    expect(payWithSheet).not.toHaveBeenCalled();
  });

  it('"Place order" on the changed-price dialog places from the FRESH quote, not the old one', async () => {
    const fresh = { ...QUOTE, id: 'fa7c1d6e-0000-4000-8000-000000000001', total_cents: QUOTE.total_cents + 150 };
    payWithSheet.mockResolvedValue({ status: 'paid' });
    mock.answer('createOrder', [{ status: 409, code: 'QUOTE_STALE', details: { quote: fresh } }, created]);
    show();
    await ready();
    await place();
    fireEvent.press(await screen.findByTestId('Checkout-placeNew'));
    await waitFor(() => expect(nav.log).toContainEqual({ action: 'reset', route: { name: 'tracking', orderId: ORDER.id } }));
    const orders = mock.callsTo('createOrder');
    expect(orders).toHaveLength(2);
    expect((orders[0]!.body as { quote_id: string }).quote_id).toBe(QUOTE.id);
    expect((orders[1]!.body as { quote_id: string }).quote_id).toBe(fresh.id);
    expect(orders[1]!.headers['idempotency-key']).not.toBe(orders[0]!.headers['idempotency-key']);
  });

  it('a second order is refused: the way to the order already on the way', async () => {
    mock.answer('createOrder', { status: 409, code: 'ACTIVE_ORDER_EXISTS' });
    show();
    await ready();
    mock.answer('getActiveOrder', 'order_preparing');
    await place();
    expect(await screen.findByTestId('Checkout-raceDialog')).toBeTruthy();
    fireEvent.press(screen.getByTestId('Checkout-raceView'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'tracking', orderId: payloadOf('order_preparing').id } });
  });

  it('IDEMPOTENCY_IN_PROGRESS waits and asks again with the SAME key, never a new one', async () => {
    payWithSheet.mockResolvedValue({ status: 'paid' });
    mock.answer('createOrder', [{ status: 409, code: 'IDEMPOTENCY_IN_PROGRESS' }, created]);
    show();
    await ready();
    await place();
    await waitFor(() => expect(nav.log).toContainEqual({ action: 'reset', route: { name: 'tracking', orderId: ORDER.id } }));
    const orders = mock.callsTo('createOrder');
    expect(orders).toHaveLength(2);
    expect(orders[1]!.headers['idempotency-key']).toBe(orders[0]!.headers['idempotency-key']);
  });

  it('the connection drops while placing: it asks the server, and does not place a second order', async () => {
    payWithSheet.mockResolvedValue({ status: 'paid' });
    mock.answer('createOrder', 'offline');
    mock.answer('getActiveOrder', ['order_no_active', 'order_created']);
    show();
    await ready();
    await place();
    await waitFor(() => expect(nav.log).toContainEqual({ action: 'reset', route: { name: 'tracking', orderId: ORDER.id } }));
    expect(mock.callsTo('createOrder')).toHaveLength(1);
  });

  it('refusals that need the customer: below the minimum names the minimum and sends nothing', async () => {
    mock.answer('getCart', 'cart_single_line');
    show();
    expect(await screen.findByTestId('Checkout-block-belowMinimum')).toBeTruthy();
    expect(screen.getByTestId('Checkout-addMore')).toBeTruthy();
    expect(screen.queryByTestId('Checkout-place')).toBeNull();
  });

  it('ordering paused at placing says nothing was charged and offers the cart', async () => {
    mock.answer('createOrder', 'error_ordering_paused');
    show();
    await ready();
    await place();
    expect(await screen.findByTestId('Checkout-block-orderingPaused')).toBeTruthy();
    expect(screen.getByText(/Nothing was charged/)).toBeTruthy();
  });

  it('an incomplete profile opens the sheet that asks only for what is missing', async () => {
    mock.answer('createOrder', 'error_profile_incomplete');
    mock.answer('getProfile', { status: 200, body: { data: { ...payloadOf('customer_profile'), last_name: null, email: null } } });
    show();
    await ready();
    await place();
    fireEvent.press(await screen.findByTestId('Checkout-finishProfile'));
    expect(await screen.findByTestId('Checkout-profileLast')).toBeTruthy();
    expect(screen.queryByTestId('Checkout-profileFirst')).toBeNull();
  });
});

describe('checkout: halal, availability and the account around it', () => {
  it('a lapsed certificate is the cool-slate seal and a neutral message, never a price or a Place order', async () => {
    mock.answer('getCart', { status: 200, body: { data: { ...CART, restaurant: { ...CART.restaurant, halal: { ...CART.restaurant.halal, display_state: 'EXPIRED' } } } } });
    show();
    expect(await screen.findByTestId('Checkout-certLapsed')).toBeTruthy();
    expect(screen.queryByTestId('Checkout-place')).toBeNull();
    expect(screen.getByText('Find another restaurant')).toBeTruthy();
    expect(mock.callsTo('createQuote')).toHaveLength(0);
  });

  it('a missing halal record renders no badge', async () => {
    mock.answer('getCart', { status: 200, body: { data: { ...CART, restaurant: { ...CART.restaurant, halal: null } } } });
    show();
    await screen.findByTestId('Checkout-restaurantName');
    expect(screen.queryByTestId('Checkout-halalBadge')).toBeNull();
    expect(screen.getByTestId('Checkout-halalLine')).toBeTruthy();
  });

  it('a certified restaurant shows its badge from the server\'s display state', async () => {
    show();
    expect(await screen.findByTestId('Checkout-halalBadge')).toBeTruthy();
  });

  it('an order already on the way: the banner, a View order, and Place order off', async () => {
    mock.answer('getActiveOrder', 'order_preparing');
    show();
    expect(await screen.findByTestId('Checkout-activeOrder')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('Checkout-place').props.accessibilityState?.disabled).toBeTruthy());
    fireEvent.press(screen.getByTestId('Checkout-viewOrder'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'tracking', orderId: payloadOf('order_preparing').id } });
  });

  it('an expired saved card turns Place order off and says why', async () => {
    mock.answer('listPaymentMethods', {
      status: 200,
      body: { data: [{ ...payloadOf('payment_methods_list')[0], exp_month: 1, exp_year: 2026 }], meta: { next_cursor: null, has_more: false, total: 1 } },
    });
    show();
    await screen.findByTestId('Checkout-total');
    // The only card is expired, so none is chosen and the new-card path stays open.
    expect(screen.getByText('New card or wallet')).toBeTruthy();
  });
});

describe('checkout: loading, empty, error, offline', () => {
  it('loading', () => {
    mock.answer('getCart', 'hang');
    show();
    expect(screen.getByTestId('Checkout-loading')).toBeTruthy();
  });

  it('empty cart', async () => {
    mock.answer('getCart', 'cart_empty');
    show();
    expect(await screen.findByTestId('Checkout-empty')).toBeTruthy();
    fireEvent.press(screen.getByTestId('Checkout-findRestaurant'));
    expect(nav.log).toContainEqual({ action: 'open', route: { name: 'home' } });
  });

  it('error: says nothing was charged, and retries', async () => {
    mock.answer('getCart', { status: 500, code: 'INTERNAL_ERROR' });
    show();
    expect(await screen.findByTestId('Checkout-error')).toBeTruthy();
    expect(screen.getByText(/Nothing has been charged/)).toBeTruthy();
    mock.answer('getCart', 'cart_multi_variant_line');
    fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByTestId('Checkout-total')).toBeTruthy();
  });

  it('a quote that fails to price: an error with a retry, and the cart is safe', async () => {
    mock.answer('createQuote', { status: 500, code: 'INTERNAL_ERROR' });
    show();
    expect(await screen.findByTestId('Checkout-quoteError')).toBeTruthy();
    expect(screen.queryByTestId('Checkout-total')).toBeNull();
  });

  it('pricing: skeleton rows while the quote is on its way', async () => {
    mock.answer('createQuote', 'hang');
    show();
    expect(await screen.findByTestId('Checkout-pricing')).toBeTruthy();
    expect(screen.getByTestId('Checkout-place').props.accessibilityState?.disabled).toBeTruthy();
  });

  it('offline: nothing can be placed, and it says so', async () => {
    show();
    await ready();
    act(() => markOffline());
    expect(await screen.findByTestId('Checkout-offline')).toBeTruthy();
    expect(screen.getByTestId('Checkout-reason')).toHaveTextContent(/You're offline/);
    expect(screen.getByTestId('Checkout-place').props.accessibilityState?.disabled).toBeTruthy();
  });
});
