/**
 * R41 Deliveries (HW/Deliveries), light and dark: loading, empty, error, offline on a first open,
 * 429, paused, populated (grouped by day, time and distance first, code second, each row its own
 * `gross_cents`), a reversed row, a row with no assignment, explicit paging on the meta cursor, a
 * failed older page keeping the rows, the end, the saved copy offline, and the way in from the
 * Earnings tab.
 */
import './mocks';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { reportTransportFailure, resetConnectivity } from '../../data/connectivity';
import { registerScreen } from '../../nav/registry';
import { formatTime } from '../../format/time';
import { mockApi, type MockApi } from '../../test/mockApi';
import { SCHEMES } from '../../test/render';
import { dayLabel, kmLabel } from '../../earnings/format';
import { DELIVERIES } from '../copy';
import { ACCOUNT_NOT_ACTIVE, deliveryLine, money, page, payoutList, renderEarningsTab, renderRoute } from './harness';

// The tab roots these tests switch to are other WPs' screens: probes say where the app went.
registerScreen('home', { component: () => null });

/** Earnings tab → its History card's Deliveries row, once the summary has loaded. */
async function openFromEarnings(scheme: (typeof SCHEMES)[number]): Promise<void> {
  renderEarningsTab(scheme);
  await waitFor(() => expect(screen.getByTestId('earnings-gross')).toBeTruthy());
  fireEvent.press(screen.getByTestId('earnings-open-deliveries'));
}

let api: MockApi;
afterEach(() => {
  api?.restore();
  resetConnectivity();
});

// Derived from earning_entries_mixed's DELIVERY line: three jobs over two days, one reversed,
// one with no assignment (fixture request: earning_entries_deliveries).
const a = deliveryLine({ id: 'e-1', earned_at: '2026-09-27T21:12:00-04:00', billable_distance_m: 4400, gross_cents: 939, order_code: 'HG-4K2M-9T', assignment_id: 'as-1' });
const b = deliveryLine({ id: 'e-2', earned_at: '2026-09-27T19:58:00-04:00', billable_distance_m: 3300, gross_cents: 779, order_code: 'HG-7PQ3-2D', assignment_id: 'as-2', status: 'REVERSED' });
const c = deliveryLine({ id: 'e-3', earned_at: '2026-09-26T17:44:00-04:00', billable_distance_m: 2700, gross_cents: 569, order_code: null, assignment_id: null });

describe.each(SCHEMES)('Deliveries (%s)', (scheme) => {
  it('loading: the skeleton and its status line; asks for DELIVERY lines only', async () => {
    api = mockApi({ listRiderEarningEntries: 'pending' });
    renderRoute(scheme, 'deliveries', undefined);
    expect(screen.getByTestId('deliveries-skeleton', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText(DELIVERIES.loading)).toBeTruthy();
    await waitFor(() => expect(api.callsTo('listRiderEarningEntries')).toHaveLength(1));
    expect(api.callsTo('listRiderEarningEntries')[0]!.query.type).toBe('DELIVERY');
  });

  it('rows by day: time and distance first, code second, each its own gross_cents; reversed and plain rows', async () => {
    api = mockApi({ listRiderEarningEntries: page([a, b, c]) });
    renderRoute(scheme, 'deliveries', undefined);
    await screen.findByTestId('delivery-row-e-1');
    expect(screen.getByText(DELIVERIES.intro)).toBeTruthy();
    expect(screen.getByText(dayLabel(a.earned_at))).toBeTruthy();
    expect(screen.getByText(dayLabel(c.earned_at))).toBeTruthy();
    for (const e of [a, b, c]) {
      const row = within(screen.getByTestId(`delivery-row-${e.id}`));
      expect(row.getByText(`${formatTime(e.earned_at)} · ${kmLabel(e.billable_distance_m)}`)).toBeTruthy();
      expect(row.getByText(money(e.gross_cents))).toBeTruthy();
    }
    expect(within(screen.getByTestId('delivery-row-e-1')).getByText('HG-4K2M-9T')).toBeTruthy();
    expect(within(screen.getByTestId('delivery-row-e-2')).getByText(DELIVERIES.reversed)).toBeTruthy();
    expect(within(screen.getByTestId('delivery-row-e-3')).getByText(DELIVERIES.noDetail)).toBeTruthy();
    // Nothing is added up: no total of the three anywhere.
    expect(screen.queryByText(money(a.gross_cents + b.gross_cents + c.gross_cents))).toBeNull();
    expect(screen.getByText(DELIVERIES.end)).toBeTruthy();
    expect(screen.getByLabelText('Back to Earnings')).toBeTruthy();

    // A plain row opens nothing; a linked row opens its own delivery.
    fireEvent.press(screen.getByTestId('delivery-row-e-3'));
    expect(screen.getByTestId('current-route').props.children).toBe('deliveries');
    fireEvent.press(screen.getByTestId('delivery-row-e-1'));
    await waitFor(() => expect(screen.getByTestId('current-route').props.children).toBe('delivery'));
    await waitFor(() => expect(api.callsTo('getAssignment')).toHaveLength(1));
    expect(api.callsTo('getAssignment')[0]!.path).toBe('/v1/riders/me/assignments/as-1');
  });

  it('pages on the meta cursor; a failed page keeps the rows; Try again carries on to the end', async () => {
    api = mockApi({
      listRiderEarningEntries: (call, n) => {
        if (!call.query.cursor) return page([a, b], { next_cursor: 'cur-2', has_more: true });
        return n === 1 ? 'error_internal_error' : page([c]);
      },
    });
    renderRoute(scheme, 'deliveries', undefined);
    await screen.findByText(DELIVERIES.more);
    expect(screen.queryByText(DELIVERIES.end)).toBeNull();

    fireEvent.press(screen.getByTestId('deliveries-more'));
    await screen.findByText(DELIVERIES.moreError.title);
    expect(screen.getByText(DELIVERIES.moreError.body)).toBeTruthy();
    expect(screen.getByTestId('delivery-row-e-1')).toBeTruthy();

    fireEvent.press(screen.getByTestId('deliveries-more-retry'));
    await screen.findByTestId('delivery-row-e-3');
    expect(screen.getByText(DELIVERIES.end)).toBeTruthy();
    const older = api.callsTo('listRiderEarningEntries').filter((x) => x.query.cursor);
    expect(older.map((x) => [x.query.cursor, x.query.type])).toEqual([
      ['cur-2', 'DELIVERY'],
      ['cur-2', 'DELIVERY'],
    ]);
  });

  it('offline after a load: the saved copy stays with its time, and older deliveries wait', async () => {
    api = mockApi({ listRiderEarningEntries: page([a], { next_cursor: 'cur-2', has_more: true }) });
    renderRoute(scheme, 'deliveries', undefined);
    await screen.findByTestId('delivery-row-e-1');
    act(() => reportTransportFailure());
    expect(screen.getByText("You're offline")).toBeTruthy();
    expect(screen.getByText(/^These deliveries are as saved at \d{1,2}:\d{2} [ap]m today\.$/)).toBeTruthy();
    expect(screen.getByText(DELIVERIES.moreOffline)).toBeTruthy();
    expect(screen.queryByText(DELIVERIES.more)).toBeNull();
  });

  it('empty: none yet, Go to Home switches to the Home tab', async () => {
    api = mockApi({
      getRiderEarningsSummary: 'earnings_summary_week',
      listRiderPayouts: payoutList('payout_draft'),
      listRiderEarningEntries: (call) => (call.query.type === 'DELIVERY' ? 'earning_entries_empty' : 'earning_entries_mixed'),
    });
    await openFromEarnings(scheme);
    await screen.findByText(DELIVERIES.empty.title);
    expect(screen.getByText(`${DELIVERIES.empty.body} ${DELIVERIES.empty.more}`)).toBeTruthy();
    fireEvent.press(screen.getByText(DELIVERIES.empty.action));
    expect(screen.getByTestId('current-route').props.children).toBe('home');
  });

  it('error: couldn’t load, Try again asks again', async () => {
    api = mockApi({ listRiderEarningEntries: (_c, n) => (n === 0 ? 'error_internal_error' : page([a])) });
    renderRoute(scheme, 'deliveries', undefined);
    await screen.findByText(DELIVERIES.error.title);
    expect(screen.getByText(DELIVERIES.error.body)).toBeTruthy();
    fireEvent.press(screen.getByTestId('deliveries-error-retry'));
    await screen.findByTestId('delivery-row-e-1');
    expect(api.callsTo('listRiderEarningEntries')).toHaveLength(2);
  });

  it('offline on a first open: no saved copy, its own words', async () => {
    api = mockApi({ listRiderEarningEntries: 'offline' });
    renderRoute(scheme, 'deliveries', undefined);
    await screen.findByText(DELIVERIES.offline.title);
    expect(screen.getByText(DELIVERIES.offline.body)).toBeTruthy();
  });

  it('429: a short pause, Try again held for 30 seconds', async () => {
    api = mockApi({ listRiderEarningEntries: 'error_rate_limited' });
    renderRoute(scheme, 'deliveries', undefined);
    await screen.findByText(DELIVERIES.rateLimited.title);
    expect(screen.getByText('You can try again in 30 seconds.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('deliveries-error-retry'));
    expect(api.callsTo('listRiderEarningEntries')).toHaveLength(1);
  });

  it('paused (403 ACCOUNT_NOT_ACTIVE): what still holds, Go to Account', async () => {
    api = mockApi({ listRiderEarningEntries: ACCOUNT_NOT_ACTIVE });
    renderRoute(scheme, 'deliveries', undefined);
    await screen.findByText(DELIVERIES.paused.title);
    expect(screen.getByText(DELIVERIES.paused.body)).toBeTruthy();
    expect(screen.getByText('Go to Account')).toBeTruthy();
    expect(screen.queryByTestId(/^delivery-row-/)).toBeNull();
  });
});

describe.each(SCHEMES)('Earnings → Deliveries (%s)', (scheme) => {
  it('the History card opens Deliveries, and back returns to Earnings', async () => {
    api = mockApi({ getRiderEarningsSummary: 'earnings_summary_week', listRiderPayouts: payoutList('payout_draft'), listRiderEarningEntries: page([a]) });
    await openFromEarnings(scheme);
    await screen.findByTestId('delivery-row-e-1');
    fireEvent.press(screen.getByLabelText('Back to Earnings'));
    expect(screen.getByTestId('current-route').props.children).toBe('earnings');
  });
});
