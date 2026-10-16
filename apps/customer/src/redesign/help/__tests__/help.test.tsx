/**
 * Get help and Report a problem against the contract's fixtures: which rows each order state gets,
 * the phone line open, closed and unavailable, the halal explainer, and the report form from empty
 * to sent, refused and failed.
 */
import * as React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { Schema } from '@hg/api-client';

import { resetPublicConfigCache } from '../../api/config';
import { resetConnectivity } from '../../lib/connectivity';
import { mockApi, payloadOf, type MockAnswer, type MockApi } from '../../test/mockApi';
import { navSpy, renderRedesign } from '../../test/render';
import { keysOf, MONEY_KEY } from '../../test/requests';
import { TrackingScreen } from '../../tracking/TrackingScreen';
import { ReportProblemScreen } from '../ReportProblemScreen';
import type { Route } from '../../navigation/routes';

jest.mock('../../../screens/TrackingScreen', () => {
  const { Text } = require('react-native');
  return { TrackingScreen: () => <Text testID="LegacyTracking">legacy tracking</Text> };
});

type Order = Schema['OrderCustomerView'];
type Config = Schema['PublicConfig'];

const ok = (data: unknown): MockAnswer => ({ status: 200, body: { data } });
const list = (data: unknown[]): MockAnswer => ({ status: 200, body: { data, meta: { next_cursor: null, has_more: false } } });
const order = (scenario: string, patch: Partial<Order> = {}): Order => ({ ...payloadOf<Order>(scenario), ...patch });
const config = (patch: Partial<Config>): Config => ({ ...payloadOf<Config>('public_config'), ...patch });

let mock: MockApi;
beforeEach(() => {
  resetPublicConfigCache();
  resetConnectivity();
});
afterEach(() => mock?.restore());

function renderTracking(o: Order, answers: Record<string, MockAnswer> = {}, route: Route = { name: 'tracking', orderId: 'o1' }) {
  mock = mockApi({
    getOrder: ok(o),
    getOrderTracking: ok(payloadOf('tracking_picked_up')),
    listRefunds: list([]),
    ...answers,
  });
  const nav = navSpy(route);
  renderRedesign(<TrackingScreen orderId="o1" />, { nav });
  return nav;
}

async function openHelp() {
  fireEvent.press(await screen.findByTestId('Tracking-getHelp'));
  expect(await screen.findByTestId('GetHelp-sheet')).toBeTruthy();
}

describe('the Get help sheet before delivery', () => {
  it('offers late, report a problem, a halal concern and something else', async () => {
    renderTracking(order('order_picked_up'));
    await openHelp();
    for (const id of ['GetHelp-late', 'GetHelp-report', 'GetHelp-halal', 'GetHelp-else']) expect(screen.getByTestId(id)).toBeTruthy();
  });

  it('Report a problem opens the form for this order with no reason chosen', async () => {
    const o = order('order_picked_up');
    const nav = renderTracking(o);
    await openHelp();
    fireEvent.press(screen.getByTestId('GetHelp-report'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'reportProblem', orderId: o.id } });
  });

  it('My order is late reads the server estimate and deadline, and decides nothing itself', async () => {
    const o = order('order_picked_up');
    renderTracking(o);
    await openHelp();
    fireEvent.press(screen.getByTestId('GetHelp-late'));
    expect(await screen.findByTestId('GetHelp-lateView')).toBeTruthy();
    expect(screen.getByTestId('GetHelp-eta')).toBeTruthy();
    expect(screen.getByTestId('GetHelp-lateBy')).toBeTruthy();
  });

  it('the halal concern is an explainer: the restaurant badge from its own record, no form, nothing sent', async () => {
    renderTracking(order('order_picked_up'));
    await openHelp();
    fireEvent.press(screen.getByTestId('GetHelp-halal'));
    expect(await screen.findByTestId('GetHelp-halalView')).toBeTruthy();
    expect(screen.getByTestId('GetHelp-halalBadge')).toBeTruthy();
    expect(screen.getByText(/does not itself certify food/)).toBeTruthy();
    expect(mock.callsTo('createRefund')).toHaveLength(0);
  });

  it('a restaurant with no halal record draws no badge at all', async () => {
    const o = order('order_picked_up');
    renderTracking({ ...o, restaurant: { ...o.restaurant, halal: undefined } });
    await openHelp();
    fireEvent.press(screen.getByTestId('GetHelp-halal'));
    expect(await screen.findByTestId('GetHelp-halalView')).toBeTruthy();
    expect(screen.queryByTestId('GetHelp-halalBadge')).toBeNull();
  });
});

describe('the phone line', () => {
  it('open: the number from the config, formatted, with a Call us button', async () => {
    renderTracking(order('order_picked_up'));
    await openHelp();
    fireEvent.press(screen.getByTestId('GetHelp-else'));
    expect(await screen.findByTestId('GetHelp-contactOpen')).toBeTruthy();
    const digits = (payloadOf<Config>('public_config').support_phone_e164 ?? '').replace(/\D/g, '');
    expect(screen.getByTestId('GetHelp-phone').props.children.replace(/\D/g, '')).toBe(digits);
    expect(screen.getByTestId('GetHelp-callButton')).toBeTruthy();
  });

  it('closed: the hours as written, no number, and the self-serve rows', async () => {
    renderTracking(order('order_picked_up'), { getPublicConfig: 'public_config_phone_support_off' });
    await openHelp();
    fireEvent.press(screen.getByTestId('GetHelp-else'));
    expect(await screen.findByTestId('GetHelp-contactClosed')).toBeTruthy();
    expect(screen.getByText('Our phone line is closed')).toBeTruthy();
    expect(screen.getByText(/Support Hours/)).toBeTruthy();
    expect(screen.queryByTestId('GetHelp-phone')).toBeNull();
    expect(screen.getByTestId('GetHelp-reportNow')).toBeTruthy();
  });

  it('unavailable: no hours, no number, still not a dead end', async () => {
    renderTracking(order('order_picked_up'), {
      getPublicConfig: ok(config({ support_enabled: false, support_phone_e164: null, support_hours: null })),
    });
    await openHelp();
    fireEvent.press(screen.getByTestId('GetHelp-else'));
    expect(await screen.findByTestId('GetHelp-contactUnavailable')).toBeTruthy();
    expect(screen.getByText("Phone support isn't available right now")).toBeTruthy();
    expect(screen.queryByText(/Support Hours/)).toBeNull();
    expect(screen.getByTestId('GetHelp-halalNow')).toBeTruthy();
  });

  it('a config that cannot be read is "unavailable", never a guess', async () => {
    renderTracking(order('order_picked_up'), { getPublicConfig: { status: 500, code: 'INTERNAL_ERROR' } });
    await openHelp();
    fireEvent.press(screen.getByTestId('GetHelp-else'));
    expect(await screen.findByTestId('GetHelp-contactUnavailable')).toBeTruthy();
  });
});

describe('the Get help sheet from Orders and Receipt', () => {
  it('a delivered order lists the after-delivery reports, each opening the form with its reason', async () => {
    const o = order('order_delivered');
    const nav = renderTracking(o, {}, { name: 'tracking', orderId: o.id, sheet: 'getHelp' });
    expect(await screen.findByTestId('GetHelp-topicsAfter')).toBeTruthy();
    fireEvent.press(screen.getByTestId('GetHelp-never'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'reportProblem', orderId: o.id, reason: 'NEVER_DELIVERED' } });
  });

  it('a halal concern after delivery opens the form with HALAL_CONCERN chosen', async () => {
    const o = order('order_delivered');
    const nav = renderTracking(o, {}, { name: 'tracking', orderId: o.id, sheet: 'getHelp' });
    fireEvent.press(await screen.findByTestId('GetHelp-halalAfter'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'reportProblem', orderId: o.id, reason: 'HALAL_CONCERN' } });
  });

  it('an order that ended has only the way to reach us', async () => {
    const o = order('order_cancelled');
    renderTracking(o, { getOrderPayment: 'payment_canceled' }, { name: 'tracking', orderId: o.id, sheet: 'getHelp' });
    expect(await screen.findByTestId('GetHelp-contactOpen')).toBeTruthy();
    expect(screen.queryByTestId('GetHelp-topicsBefore')).toBeNull();
    expect(screen.queryByTestId('GetHelp-topicsAfter')).toBeNull();
  });
});

/* ------------------------------------------------------------------------ the report form */

function renderReport(o: Order, answers: Record<string, MockAnswer> = {}, reason?: string) {
  mock = mockApi({ getOrder: ok(o), listRefunds: list([]), ...answers });
  const nav = navSpy({ name: 'reportProblem', orderId: o.id, reason });
  renderRedesign(<ReportProblemScreen orderId={o.id} reason={reason} />, { nav });
  return nav;
}

const delivered = () => order('order_delivered');

describe('Report a problem after delivery', () => {
  it('opens with the reason the row chose and nothing chosen for the part of the order', async () => {
    renderReport(delivered(), {}, 'NEVER_DELIVERED');
    expect(await screen.findByTestId('Report-body')).toBeTruthy();
    expect(screen.getByTestId('Report-reason-NEVER_DELIVERED')).toBeTruthy();
    expect(screen.queryByTestId('Report-reason-OTHER')).toBeNull();
    expect(screen.queryByText(/photo/i)).toBeNull();
    expect(screen.queryByText(/\bonce\b/i)).toBeNull();
  });

  it('validates on press: no reason, then no part of the order, sends nothing', async () => {
    renderReport(delivered());
    fireEvent.press(await screen.findByTestId('Report-send'));
    expect(await screen.findByTestId('Report-reasons-error')).toBeTruthy();
    fireEvent.press(screen.getByTestId('Report-reason-MISSING_ITEMS'));
    fireEvent.press(screen.getByTestId('Report-send'));
    expect(await screen.findByTestId('Report-kinds-error')).toBeTruthy();
    expect(mock.callsTo('createRefund')).toHaveLength(0);
  });

  it('sends the reason and the whole order with an Idempotency-Key and no amount, then reads "Under review"', async () => {
    const o = delivered();
    renderReport(o, { createRefund: ok(payloadOf('refund_requested')) }, 'HALAL_CONCERN');
    fireEvent.press(await screen.findByTestId('Report-kind-FULL'));
    fireEvent.changeText(screen.getByTestId('Report-note'), 'The label did not match.');
    fireEvent.press(screen.getByTestId('Report-send'));
    expect(await screen.findByTestId('Report-sent')).toBeTruthy();
    const [call] = mock.callsTo('createRefund');
    expect(call.headers['idempotency-key']).toBeTruthy();
    expect(call.body).toEqual({ order_id: o.id, kind: 'FULL', reason_code: 'HALAL_CONCERN', note: 'The label did not match.' });
    expect(keysOf(call.body).filter((k) => MONEY_KEY.test(k))).toEqual([]);
    expect(screen.getByText('Under review')).toBeTruthy();
    // A request, not a decision: no amount and no promise of a refund.
    expect(screen.queryByText(/\$/)).toBeNull();
    expect(screen.queryByText(/refunded|approved/i)).toBeNull();
  });

  it('some items: needs at least one, then sends quantities only', async () => {
    const o = delivered();
    renderReport(o, { createRefund: ok(payloadOf('refund_requested')) }, 'MISSING_ITEMS');
    fireEvent.press(await screen.findByTestId('Report-kind-PARTIAL_ITEMS'));
    fireEvent.press(screen.getByTestId('Report-send'));
    expect(await screen.findByTestId('Report-itemsError')).toBeTruthy();
    const first = o.lines[0]!;
    fireEvent.press(screen.getByTestId(`Report-stepper-${first.line_no}-increment`));
    fireEvent.press(screen.getByTestId('Report-send'));
    expect(await screen.findByTestId('Report-sent')).toBeTruthy();
    const [call] = mock.callsTo('createRefund');
    expect(call.body).toMatchObject({ kind: 'PARTIAL_ITEMS', lines: [{ order_line_no: first.line_no, quantity: 1 }] });
    expect(keysOf(call.body).filter((k) => MONEY_KEY.test(k))).toEqual([]);
  });

  it('a failure keeps every answer; Send again repeats the same request with the same key', async () => {
    renderReport(delivered(), { createRefund: [{ status: 500, code: 'INTERNAL_ERROR' }, ok(payloadOf('refund_requested'))] }, 'NEVER_DELIVERED');
    fireEvent.press(await screen.findByTestId('Report-kind-FULL'));
    fireEvent.press(screen.getByTestId('Report-send'));
    expect(await screen.findByTestId('Report-failed')).toBeTruthy();
    expect(screen.getByText('Send again')).toBeTruthy();
    fireEvent.press(screen.getByTestId('Report-send'));
    expect(await screen.findByTestId('Report-sent')).toBeTruthy();
    const [a, b] = mock.callsTo('createRefund');
    expect(b.headers['idempotency-key']).toBe(a.headers['idempotency-key']);
  });

  it('a changed answer gets a new key', async () => {
    renderReport(delivered(), { createRefund: [{ status: 500, code: 'INTERNAL_ERROR' }, ok(payloadOf('refund_requested'))] }, 'NEVER_DELIVERED');
    fireEvent.press(await screen.findByTestId('Report-kind-FULL'));
    fireEvent.press(screen.getByTestId('Report-send'));
    await screen.findByTestId('Report-failed');
    fireEvent.changeText(screen.getByTestId('Report-note'), 'Nothing at the door.');
    fireEvent.press(screen.getByTestId('Report-send'));
    await screen.findByTestId('Report-sent');
    const [a, b] = mock.callsTo('createRefund');
    expect(b.headers['idempotency-key']).not.toBe(a.headers['idempotency-key']);
  });

  it('409 already requested: shows the report that holds the claim, and lets the customer change theirs', async () => {
    const held = payloadOf<Schema['Refund']>('refund_requested');
    renderReport(delivered(), { createRefund: { status: 409, code: 'REFUND_ALREADY_REQUESTED' }, listRefunds: list([held]) }, 'MISSING_ITEMS');
    fireEvent.press(await screen.findByTestId('Report-kind-FULL'));
    fireEvent.press(screen.getByTestId('Report-send'));
    expect(await screen.findByText('A report already covers this')).toBeTruthy();
    expect(await screen.findByTestId('Report-card')).toBeTruthy();
    fireEvent.press(screen.getByTestId('Report-edit'));
    expect(await screen.findByTestId('Report-body')).toBeTruthy();
  });

  it('409 not refundable and 409 window closed each get their own page', async () => {
    renderReport(delivered(), { createRefund: { status: 409, code: 'PAYMENT_NOT_REFUNDABLE' } }, 'NEVER_DELIVERED');
    fireEvent.press(await screen.findByTestId('Report-kind-FULL'));
    fireEvent.press(screen.getByTestId('Report-send'));
    expect(await screen.findByTestId('Report-notRefundable')).toBeTruthy();
  });

  it('window closed says so without inventing a number of hours', async () => {
    renderReport(delivered(), { createRefund: { status: 409, code: 'REFUND_WINDOW_CLOSED' } }, 'NEVER_DELIVERED');
    fireEvent.press(await screen.findByTestId('Report-kind-FULL'));
    fireEvent.press(screen.getByTestId('Report-send'));
    expect(await screen.findByTestId('Report-windowClosed')).toBeTruthy();
    expect(screen.queryByText(/\b48\b|\b72\b/)).toBeNull();
  });
});

describe('Report a problem before delivery', () => {
  it('offers the reasons that fit before delivery and no part-of-order question', async () => {
    renderReport(order('order_picked_up'));
    expect(await screen.findByTestId('Report-reason-LATE_DELIVERY')).toBeTruthy();
    expect(screen.getByTestId('Report-reason-WRONG_ADDRESS')).toBeTruthy();
    expect(screen.getByTestId('Report-reason-CUSTOMER_CHANGED_MIND')).toBeTruthy();
    expect(screen.queryByTestId('Report-kinds')).toBeNull();
  });

  it('a wrong address needs the right address in the note before anything is sent', async () => {
    const o = order('order_picked_up');
    renderReport(o, { createRefund: ok(payloadOf('refund_wrong_address_before_delivery')) }, 'WRONG_ADDRESS');
    fireEvent.press(await screen.findByTestId('Report-send'));
    expect(await screen.findByText('Tell us the right address, in at least 5 characters.')).toBeTruthy();
    expect(mock.callsTo('createRefund')).toHaveLength(0);
    fireEvent.changeText(screen.getByTestId('Report-note'), '22 Wellesley Street East');
    fireEvent.press(screen.getByTestId('Report-send'));
    await waitFor(() => expect(mock.callsTo('createRefund')).toHaveLength(1));
    expect(mock.callsTo('createRefund')[0]!.body).toMatchObject({ kind: 'FULL', reason_code: 'WRONG_ADDRESS' });
  });
});

describe('Report a problem: the order itself', () => {
  it('an order the restaurant has not accepted has nothing to report here', async () => {
    renderReport(order('order_restaurant_pending'));
    expect(await screen.findByTestId('Report-notRefundable')).toBeTruthy();
    expect(mock.callsTo('createRefund')).toHaveLength(0);
  });

  it('loading, then an error with Try again', async () => {
    mock = mockApi({ getOrder: [{ status: 500, code: 'INTERNAL_ERROR' }, ok(delivered())] });
    renderRedesign(<ReportProblemScreen orderId="o1" />, { nav: navSpy({ name: 'reportProblem', orderId: 'o1' }) });
    expect(screen.getByTestId('Report-loading')).toBeTruthy();
    expect(await screen.findByTestId('Report-error')).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByTestId('Report-body')).toBeTruthy();
  });

  it('dark renders the same form', async () => {
    mock = mockApi({ getOrder: ok(delivered()) });
    renderRedesign(<ReportProblemScreen orderId="o1" />, { nav: navSpy({ name: 'reportProblem', orderId: 'o1' }), scheme: 'dark' });
    expect(await screen.findByTestId('Report-body')).toBeTruthy();
  });
});
