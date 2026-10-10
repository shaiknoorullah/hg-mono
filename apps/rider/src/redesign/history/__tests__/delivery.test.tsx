/**
 * R42 One delivery (HW/DeliveryDetail), light and dark: delivered (hero, earnings card from the
 * line that opened it, Where with the street only, When in 12-hour times, Items without prices,
 * Handover), the privacy rule, no handover and no wait recorded, the OTP handover, a pending
 * line, cancelled after reaching the restaurant, unavailable (REASSIGNED and 404), loading,
 * error, offline, 429 and paused; the entry points and their back labels (Deliveries, the
 * delivery's earnings line, a tip on it).
 */
import './mocks';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { formatTime } from '../../format/time';
import { mockApi, payload, type MockApi } from '../../test/mockApi';
import { SCHEMES } from '../../test/render';
import { kmLabel, longDayLabel } from '../../earnings/format';
import { DELIVERY, HANDOVER, POD } from '../copy';
import { ACCOUNT_NOT_ACTIVE, assignment, deliveryLine, money, page, renderRoute, tipLine } from './harness';

let api: MockApi;
afterEach(() => api?.restore());

const delivered = payload('assignment_delivered');
// The DELIVERY line for that same job (earning_entries_mixed, tied to the fixture's assignment).
const line = deliveryLine({ assignment_id: delivered.id, order_code: delivered.order_code, gross_cents: 1149, status: 'AVAILABLE' });

describe.each(SCHEMES)('One delivery (%s)', (scheme) => {
  it('delivered: hero, what it earned, where (street only), when, items, handover; nothing private', async () => {
    api = mockApi({ getAssignment: 'assignment_delivered' });
    renderRoute(scheme, 'delivery', { assignmentId: delivered.id, from: 'deliveries', entry: line });
    await screen.findByTestId('delivery-hero');
    expect(api.callsTo('getAssignment')[0]!.path).toBe(`/v1/riders/me/assignments/${delivered.id}`);
    expect(screen.getByLabelText('Back to Deliveries')).toBeTruthy();

    const hero = within(screen.getByTestId('delivery-hero'));
    expect(hero.getByText('Delivered')).toBeTruthy();
    expect(hero.getByText('Karachi Kitchen')).toBeTruthy();
    expect(hero.getByText(delivered.order_code)).toBeTruthy();
    expect(hero.getByText(new RegExp(`^${longDayLabel(delivered.delivered_at)}`))).toBeTruthy();

    const earnings = within(screen.getByTestId('delivery-earnings'));
    expect(earnings.getByText(DELIVERY.earned)).toBeTruthy();
    expect(earnings.getByText(money(line.gross_cents))).toBeTruthy();
    expect(earnings.getByText(DELIVERY.workedOut)).toBeTruthy();

    const where = within(screen.getByTestId('delivery-where'));
    expect(where.getByText(delivered.pickup.address)).toBeTruthy();
    expect(where.getByText('Harbour Street, Toronto, ON')).toBeTruthy();
    expect(where.getByText(DELIVERY.streetOnly)).toBeTruthy();
    expect(where.getByText(kmLabel(delivered.billable_distance_m))).toBeTruthy();

    const when = within(screen.getByTestId('delivery-when'));
    expect(when.getByText('Accepted')).toBeTruthy();
    expect(screen.getByTestId('delivery-time-accepted').props.children).toBe(formatTime(delivered.assigned_at));
    expect(screen.getByTestId('delivery-time-delivered').props.children).toBe(formatTime(delivered.delivered_at));
    expect(screen.getByTestId('delivery-time-delivered').props.children).toMatch(/^\d{1,2}:\d{2} [ap]m$/);
    expect(when.getByText('You waited 4 minutes at the restaurant.')).toBeTruthy();

    const items = within(screen.getByTestId('delivery-items'));
    expect(items.getByText('1 × Beef Nihari')).toBeTruthy();
    expect(items.getByText('Full')).toBeTruthy();
    expect(items.getByText('Garlic naan')).toBeTruthy();

    const handover = within(screen.getByTestId('delivery-handover'));
    expect(handover.getByText(HANDOVER.LEFT_AT_DOOR)).toBeTruthy();
    expect(handover.getByText(POD.PHOTO)).toBeTruthy();
    expect(screen.getByText(DELIVERY.problemTitle)).toBeTruthy();

    // The redacted terminal view: never unit, buzzer, instructions, the customer or any phone.
    for (const hidden of [
      delivered.dropoff.unit,
      delivered.dropoff.buzzer,
      delivered.dropoff.special_instructions,
      delivered.dropoff.customer_display_name,
      delivered.dropoff.phone_alias,
      delivered.pickup.phone_alias,
      delivered.pickup.pickup_notes,
      delivered.dropoff.address,
      'Extra gravy on the side',
    ]) {
      expect(screen.queryByText(new RegExp(hidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeNull();
    }
  });

  it('"See how it was worked out" opens the line with Back to Delivery, and the line has no Delivery details', async () => {
    api = mockApi({ getAssignment: 'assignment_delivered' });
    renderRoute(scheme, 'delivery', { assignmentId: delivered.id, from: 'deliveries', entry: line });
    fireEvent.press(await screen.findByTestId('delivery-earnings'));
    await waitFor(() => expect(screen.getByTestId('current-route').props.children).toBe('earningsLine'));
    expect(screen.getByLabelText('Back to Delivery')).toBeTruthy();
    expect(screen.queryByTestId('line-delivery')).toBeNull();
    fireEvent.press(screen.getByLabelText('Back to Delivery'));
    expect(screen.getByTestId('current-route').props.children).toBe('delivery');
  });

  it('from its earnings line: Back to Delivery earnings, and the card goes back to that line', async () => {
    api = mockApi({ getAssignment: 'assignment_delivered' });
    renderRoute(scheme, 'earningsLine', { entry: line, from: 'activity' });
    fireEvent.press(await screen.findByTestId('line-delivery'));
    await screen.findByTestId('delivery-hero');
    expect(screen.getByLabelText('Back to Delivery earnings')).toBeTruthy();
    fireEvent.press(screen.getByTestId('delivery-earnings'));
    expect(screen.getByTestId('current-route').props.children).toBe('earningsLine');
  });

  it('from a tip on it: Back to Tip, and no earnings card (the tip is not what the job earned)', async () => {
    api = mockApi({ getAssignment: 'assignment_delivered' });
    renderRoute(scheme, 'earningsLine', { entry: tipLine({ assignment_id: delivered.id }), from: 'activity' });
    fireEvent.press(await screen.findByTestId('line-delivery'));
    await screen.findByTestId('delivery-hero');
    expect(screen.getByLabelText('Back to Tip')).toBeTruthy();
    expect(screen.queryByTestId('delivery-earnings')).toBeNull();
  });

  it('a pending line reads "You earned (pending)"', async () => {
    api = mockApi({ getAssignment: 'assignment_delivered' });
    renderRoute(scheme, 'delivery', { assignmentId: delivered.id, from: 'deliveries', entry: { ...line, status: 'PENDING' } });
    await screen.findByText(DELIVERY.earnedPending);
  });

  it('no handover method, no wait recorded: no Handover card, the plain wait line', async () => {
    // Derived from assignment_delivered (fixture request: assignment_delivered_no_handover).
    api = mockApi({ getAssignment: assignment('assignment_delivered', { handover_method: null, pickup_wait_seconds: null }) });
    renderRoute(scheme, 'delivery', { assignmentId: delivered.id, from: 'deliveries', entry: line });
    await screen.findByText(DELIVERY.noWait);
    expect(screen.queryByTestId('delivery-handover')).toBeNull();
  });

  it('handed over with the customer’s code: the OTP proof line', async () => {
    // Derived from assignment_otp_pod_required, delivered (fixture request: assignment_delivered_otp).
    api = mockApi({
      getAssignment: assignment('assignment_otp_pod_required', { state: 'DELIVERED', pod_recorded: true, handover_method: 'HANDED_TO_CUSTOMER', delivered_at: '2026-08-10T18:40:11.412Z' }),
    });
    renderRoute(scheme, 'delivery', { assignmentId: 'x', from: 'deliveries' });
    const handover = within(await screen.findByTestId('delivery-handover'));
    expect(handover.getByText(HANDOVER.HANDED_TO_CUSTOMER)).toBeTruthy();
    expect(handover.getByText(POD.OTP)).toBeTruthy();
    // Opened without its line: no earnings card at all.
    expect(screen.queryByTestId('delivery-earnings')).toBeNull();
  });

  it('cancelled after reaching the restaurant: no amount, Earnings activity only, no drop-off', async () => {
    const cancelled = payload('assignment_cancelled_by_platform');
    api = mockApi({ getAssignment: 'assignment_cancelled_by_platform' });
    renderRoute(scheme, 'delivery', { assignmentId: cancelled.id, from: 'deliveries', entry: { ...line, assignment_id: cancelled.id } });
    await screen.findByText('Order cancelled');
    expect(screen.getByText(DELIVERY.cancelledAfterArrival)).toBeTruthy();
    expect(screen.queryByTestId('delivery-earnings')).toBeNull();
    expect(screen.queryByText(money(line.gross_cents))).toBeNull();
    expect(screen.getByText(DELIVERY.beforePickup)).toBeTruthy();
    expect(screen.queryByText(DELIVERY.dropoff)).toBeNull();
    expect(screen.queryByText(/You waited/)).toBeNull();
    fireEvent.press(screen.getByTestId('delivery-earnings-placeholder'));
    expect(screen.getByTestId('current-route').props.children).toBe('earningsActivity');
  });

  it.each([
    ['REASSIGNED', 'assignment_reassigned'],
    ['404', 'error_not_found'],
  ])('unavailable (%s): passed to another rider, Go to Earnings activity', async (_label, scenario) => {
    api = mockApi({ getAssignment: scenario, listRiderEarningEntries: page([]) });
    renderRoute(scheme, 'delivery', { assignmentId: 'x', from: 'deliveries', entry: line });
    await screen.findByText(DELIVERY.unavailable.title);
    expect(screen.getByText(DELIVERY.unavailable.body)).toBeTruthy();
    fireEvent.press(screen.getByText(DELIVERY.unavailable.action));
    expect(screen.getByTestId('current-route').props.children).toBe('earningsActivity');
  });

  it('loading: the skeleton and its status line', () => {
    api = mockApi({ getAssignment: 'pending' });
    renderRoute(scheme, 'delivery', { assignmentId: 'x', from: 'deliveries' });
    expect(screen.getByText(DELIVERY.loading)).toBeTruthy();
  });

  it('error: Try again asks again; "See what it earned" opens its line', async () => {
    api = mockApi({ getAssignment: (_c, n) => (n === 0 ? 'error_internal_error' : 'assignment_delivered') });
    renderRoute(scheme, 'delivery', { assignmentId: delivered.id, from: 'deliveries', entry: line });
    await screen.findByText(DELIVERY.error.title);
    expect(screen.getByText(DELIVERY.error.body)).toBeTruthy();
    fireEvent.press(screen.getByTestId('delivery-error-state-retry'));
    await screen.findByTestId('delivery-hero');
    expect(api.callsTo('getAssignment')).toHaveLength(2);
  });

  it('offline: its own words, and the line is still on this phone', async () => {
    api = mockApi({ getAssignment: 'offline' });
    renderRoute(scheme, 'delivery', { assignmentId: delivered.id, from: 'deliveries', entry: line });
    await screen.findByText(DELIVERY.offline.title);
    expect(screen.getByText(DELIVERY.offline.body)).toBeTruthy();
    fireEvent.press(screen.getByTestId('delivery-see-earned'));
    expect(screen.getByTestId('current-route').props.children).toBe('earningsLine');
  });

  it('429: a short pause, Try again held', async () => {
    api = mockApi({ getAssignment: 'error_rate_limited' });
    renderRoute(scheme, 'delivery', { assignmentId: 'x', from: 'deliveries' });
    await screen.findByText(DELIVERY.rateLimited.title);
    expect(screen.getByText('You can try again in 30 seconds.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('delivery-error-state-retry'));
    expect(api.callsTo('getAssignment')).toHaveLength(1);
    expect(screen.queryByTestId('delivery-see-earned')).toBeNull();
  });

  it('paused (403 ACCOUNT_NOT_ACTIVE): Go to Account', async () => {
    api = mockApi({ getAssignment: ACCOUNT_NOT_ACTIVE });
    renderRoute(scheme, 'delivery', { assignmentId: 'x', from: 'deliveries' });
    await screen.findByText(DELIVERY.paused.title);
    expect(screen.getByText('Go to Account')).toBeTruthy();
  });
});
