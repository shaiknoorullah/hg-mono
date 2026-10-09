/**
 * R35 Earnings (EA/Main): every state against the contract's fixtures, light and dark.
 * The money test pins the WP10 rule: every rendered amount is a fixture `*_cents` through
 * `formatPrice`, and nothing is added up on the phone.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => {
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});

import { reportReachable, reportTransportFailure, resetConnectivity } from '../../data/connectivity';
import { mockApi, payload, type MockApi } from '../../test/mockApi';
import { SCHEMES } from '../../test/render';
import { BANNERS, NEXT, PAUSED, SUMMARY } from '../copy';
import { dayLabel, isoDate, payoutPeriod, periodStart } from '../format';
import { ACCOUNT_NOT_ACTIVE, money, ok, page, payoutList, renderEarningsTab } from './harness';

let api: MockApi;
afterEach(() => {
  api?.restore();
  resetConnectivity();
});

const week = payload('earnings_summary_week');

describe.each(SCHEMES)('Earnings summary (%s)', (scheme) => {
  it('shows the summary exactly as returned: nothing is added up on the phone', async () => {
    api = mockApi({
      getRiderEarningsSummary: 'earnings_summary_week',
      listRiderPayouts: payoutList('payout_draft', 'payout_paid'),
      getConnectStatus: 'connect_status_complete',
    });
    renderEarningsTab(scheme);
    await waitFor(() => expect(screen.getByTestId('earnings-gross')).toBeTruthy());

    const t = week.total;
    expect(screen.getByTestId('earnings-gross').props.children).toBe(money(t.gross_cents));
    // The fixture's parts do not add up to its gross on purpose: a phone that summed would show
    // something else.
    expect(Number(t.delivery_cents) + Number(t.tip_cents) + Number(t.bonus_cents) + Number(t.adjustment_cents)).not.toBe(Number(t.gross_cents));
    expect(screen.getByTestId('earnings-made-of-Deliveries').props.children).toBe(money(t.delivery_cents));
    expect(screen.getByTestId('earnings-made-of-Tips').props.children).toBe(money(t.tip_cents));
    expect(screen.getByTestId('earnings-made-of-Bonuses').props.children).toBe(money(t.bonus_cents));
    expect(screen.getByTestId('earnings-made-of-Adjustments and corrections').props.children).toBe(money(t.adjustment_cents, 'always'));
    expect(screen.getByTestId('earnings-per-hour').props.children).toBe(money(t.effective_cents_per_hour));
    expect(screen.getByTestId('earnings-unpaid-amount').props.children).toBe(money(week.unpaid_balance_cents));
    // Next payout = the top payout row's own amount (DRAFT, so "so far").
    await waitFor(() => expect(screen.getByTestId('earnings-next-amount').props.children).toBe(money(payload('payout_draft').amount_cents)));
    expect(screen.getByText(NEXT.soFar)).toBeTruthy();
    expect(screen.getByText(SUMMARY.pendingLine)).toBeTruthy();
    // By day: one row per bucket, each its own gross_cents.
    week.buckets.forEach((b: { gross_cents: number }, i: number) => {
      expect(within(screen.getByTestId(`earnings-day-${i}`)).getByText(money(b.gross_cents))).toBeTruthy();
    });
    expect(screen.getByText(SUMMARY.footnote)).toBeTruthy();
    expect(screen.getByText('This week')).toBeTruthy();

    // Reads only: no request carries a body, let alone a price.
    expect(api.calls.every((c) => c.method === 'GET' && c.body === undefined)).toBe(true);
    const call = api.callsTo('getRiderEarningsSummary')[0]!;
    expect(call.query).toEqual({ period: 'WEEK', from: isoDate(periodStart('WEEK', 0)) });
  });

  it('switching to Day and stepping back asks for that period; only the period figures reload', async () => {
    api = mockApi({
      getRiderEarningsSummary: (call) => (call.query.period === 'DAY' && call.query.from !== isoDate(periodStart('DAY', 0)) ? 'pending' : 'earnings_summary_week'),
      listRiderPayouts: payoutList('payout_draft'),
    });
    renderEarningsTab(scheme);
    await waitFor(() => expect(screen.getByTestId('earnings-gross')).toBeTruthy());

    fireEvent.press(screen.getByText('Day'));
    await waitFor(() => expect(screen.getByText('Today')).toBeTruthy());
    expect(api.callsTo('getRiderEarningsSummary').at(-1)!.query).toEqual({ period: 'DAY', from: isoDate(periodStart('DAY', 0)) });

    fireEvent.press(screen.getByText('Previous day'));
    await waitFor(() => expect(screen.getByTestId('earnings-period-loading')).toBeTruthy());
    expect(screen.getByText('Yesterday')).toBeTruthy();
    expect(api.callsTo('getRiderEarningsSummary').at(-1)!.query).toEqual({ period: 'DAY', from: isoDate(periodStart('DAY', -1)) });
    // "Right now" stays drawn with its loaded values while the period loads.
    expect(screen.getByTestId('earnings-unpaid-amount').props.children).toBe(money(week.unpaid_balance_cents));
  });

  it('a By-day row opens that day, with Back to the week', async () => {
    api = mockApi({ getRiderEarningsSummary: 'earnings_summary_week', listRiderPayouts: payoutList('payout_draft') });
    renderEarningsTab(scheme);
    await waitFor(() => expect(screen.getByTestId('earnings-day-0')).toBeTruthy());
    fireEvent.press(screen.getByTestId('earnings-day-0'));
    await waitFor(() => expect(screen.getByTestId('earnings-back-to-period')).toBeTruthy());
    const last = api.callsTo('getRiderEarningsSummary').at(-1)!;
    expect(last.query.period).toBe('DAY');
    expect(screen.getByTestId('earnings-period-title').props.children).toBe(dayLabel(week.buckets[0].bucket_start));
  });

  it('first run: no entries at all shows "No earnings yet"', async () => {
    api = mockApi({ getRiderEarningsSummary: 'earnings_summary_zero', listRiderEarningEntries: 'earning_entries_empty', listRiderPayouts: 'payout_list_empty' });
    renderEarningsTab(scheme);
    await waitFor(() => expect(screen.getByText(SUMMARY.firstRun.title)).toBeTruthy());
    expect(api.callsTo('listRiderEarningEntries')[0]!.query).toEqual({ limit: '1' });
    fireEvent.press(screen.getByText('Go to Home'));
  });

  it('an empty week (earned before) shows the zero line, not "No earnings yet"', async () => {
    api = mockApi({ getRiderEarningsSummary: 'earnings_summary_zero', listRiderEarningEntries: 'earning_entries_mixed', listRiderPayouts: 'payout_list_empty' });
    renderEarningsTab(scheme);
    await waitFor(() => expect(screen.getByText('No deliveries this week. Go online from Home to get offers.')).toBeTruthy());
    expect(screen.queryByText(SUMMARY.firstRun.title)).toBeNull();
    expect(screen.getByText('No earnings on any day this week.')).toBeTruthy();
    expect(screen.getByText(NEXT.nothing)).toBeTruthy();
  });

  it('summary error keeps Payouts and History live and retries', async () => {
    api = mockApi({ getRiderEarningsSummary: (_c, n) => (n === 0 ? 'error_internal_error' : 'earnings_summary_week'), listRiderPayouts: payoutList('payout_draft') });
    renderEarningsTab(scheme);
    await waitFor(() => expect(screen.getByText(SUMMARY.error.title)).toBeTruthy());
    expect(screen.getByTestId('earnings-open-payouts')).toBeTruthy();
    expect(screen.getByTestId('earnings-open-activity')).toBeTruthy();
    fireEvent.press(screen.getByTestId('earnings-retry'));
    await waitFor(() => expect(screen.getByTestId('earnings-gross')).toBeTruthy());
  });

  it('429 shows "Too many tries in a row" with the wait, Try again held', async () => {
    api = mockApi({ getRiderEarningsSummary: 'error_rate_limited', listRiderPayouts: payoutList('payout_draft') });
    renderEarningsTab(scheme);
    await waitFor(() => expect(screen.getByText(SUMMARY.rateLimited.title)).toBeTruthy());
    expect(screen.getByText('You can try again in 30 seconds.')).toBeTruthy();
    expect(screen.getByTestId('earnings-retry').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('403 ACCOUNT_NOT_ACTIVE while paused shows the paused state and no figures', async () => {
    api = mockApi({ getRiderEarningsSummary: ACCOUNT_NOT_ACTIVE, listRiderPayouts: ACCOUNT_NOT_ACTIVE });
    renderEarningsTab(scheme);
    await waitFor(() => expect(screen.getByText(PAUSED.summary.title)).toBeTruthy());
    expect(screen.queryByTestId('earnings-gross')).toBeNull();
    fireEvent.press(screen.getByTestId('earnings-go-account'));
  });

  it('a held payout: banner with the reason word for word, Fix only when Stripe needs something', async () => {
    const held = payload('payout_held');
    api = mockApi({
      getRiderEarningsSummary: 'earnings_summary_week',
      listRiderPayouts: payoutList('payout_draft', 'payout_held'),
      getConnectStatus: ok({ ...payload('connect_status_complete'), requirements: { ...payload('connect_status_complete').requirements, currently_due: ['external_account'] } }),
    });
    renderEarningsTab(scheme);
    await waitFor(() => expect(screen.getByText(BANNERS.held.title)).toBeTruthy());
    expect(screen.getByText(new RegExp(`Reason given: ${held.hold_reason}`))).toBeTruthy();
    expect(screen.getAllByText(BANNERS.fix)).toHaveLength(1);
    expect(within(screen.getByTestId('earnings-held-extra')).getByText(money(held.amount_cents))).toBeTruthy();
    expect(screen.getByText(NEXT.heldExtra(payoutPeriod(held)))).toBeTruthy();
    fireEvent.press(screen.getByText(BANNERS.seePayout));
    await waitFor(() => expect(screen.getByTestId('current-route').props.children).toBe('earningsPayout'));
  });

  it('a failed payout and payouts paused: two banners, one Fix button', async () => {
    api = mockApi({
      getRiderEarningsSummary: 'earnings_summary_week',
      listRiderPayouts: page([payload('payout_draft'), { ...payload<Record<string, unknown>>('payout_failed'), failure_message: 'The bank account has been closed.' }]),
      getConnectStatus: 'connect_status_requirements_due',
    });
    renderEarningsTab(scheme);
    await waitFor(() => expect(screen.getByText(BANNERS.failed.title)).toBeTruthy());
    expect(screen.getByText(/Reason given: The bank account has been closed\./)).toBeTruthy();
    expect(screen.getByText(BANNERS.paused.title)).toBeTruthy();
    expect(screen.getAllByText(BANNERS.fix)).toHaveLength(1);
    expect(screen.getByText(NEXT.heldNote)).toBeTruthy();
  });

  it('payouts that could not load: the banner slot says so and Next payout offers Try again', async () => {
    api = mockApi({ getRiderEarningsSummary: 'earnings_summary_week', listRiderPayouts: 'error_internal_error' });
    renderEarningsTab(scheme);
    await waitFor(() => expect(screen.getByText(SUMMARY.slotError.title)).toBeTruthy());
    expect(screen.getByText(SUMMARY.nextFailed)).toBeTruthy();
  });

  it('connect status that could not load: the slot says so and Next payout keeps its amount with Try again', async () => {
    api = mockApi({
      getRiderEarningsSummary: 'earnings_summary_week',
      listRiderPayouts: payoutList('payout_draft'),
      getConnectStatus: (_c, n) => (n === 0 ? 'error_internal_error' : 'connect_status_complete'),
    });
    renderEarningsTab(scheme);
    await waitFor(() => expect(screen.getByText(SUMMARY.slotError.title)).toBeTruthy());
    expect(screen.getByTestId('earnings-next-amount').props.children).toBe(money(payload('payout_draft').amount_cents));
    fireEvent.press(screen.getByTestId('earnings-next-retry'));
    await waitFor(() => expect(api.callsTo('getConnectStatus')).toHaveLength(2));
    // Let the retried answers land.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByText(SUMMARY.slotError.title)).toBeNull();
    expect(api.callsTo('listRiderPayouts')).toHaveLength(2);
    expect(screen.queryByTestId('earnings-next-retry')).toBeNull();
  });

  it('balance below zero names the newest correction and opens it', async () => {
    const clawback = payload('earning_entries_mixed').find((e: { type: string }) => e.type === 'CLAWBACK');
    api = mockApi({
      // Derived from earnings_summary_week: unpaid_balance_cents below zero.
      getRiderEarningsSummary: ok({ ...week, unpaid_balance_cents: -1250 }),
      listRiderPayouts: payoutList('payout_paid'),
      listRiderEarningEntries: page([clawback]),
    });
    renderEarningsTab(scheme);
    await waitFor(() => expect(screen.getByText(NEXT.negative)).toBeTruthy());
    expect(screen.getByTestId('earnings-unpaid-amount').props.children).toBe(money(-1250));
    await waitFor(() => expect(screen.getByText(NEXT.negativeCause(dayLabel(clawback.earned_at)))).toBeTruthy());
    expect(api.callsTo('listRiderEarningEntries')[0]!.query).toEqual({ type: 'CLAWBACK', limit: '1' });
    fireEvent.press(screen.getByTestId('earnings-see-correction'));
    await waitFor(() => expect(screen.getByTestId('current-route').props.children).toBe('earningsLine'));
    expect(screen.getByLabelText('Back to Earnings')).toBeTruthy();
  });

  it('offline keeps the saved copy with its time, then updates when back online', async () => {
    api = mockApi({ getRiderEarningsSummary: 'earnings_summary_week', listRiderPayouts: payoutList('payout_draft') });
    renderEarningsTab(scheme);
    await waitFor(() => expect(screen.getByTestId('earnings-gross')).toBeTruthy());
    act(() => reportTransportFailure());
    expect(screen.getByTestId('earnings-offline')).toBeTruthy();
    expect(screen.getByText(/These are your earnings as saved at .* They update when you're back online\./)).toBeTruthy();
    const before = api.callsTo('getRiderEarningsSummary').length;
    act(() => reportReachable());
    await waitFor(() => expect(api.callsTo('getRiderEarningsSummary').length).toBeGreaterThan(before));
    expect(screen.queryByTestId('earnings-offline')).toBeNull();
  });

  it('History opens Earnings activity; the Payouts row opens Payouts', async () => {
    api = mockApi({ getRiderEarningsSummary: 'earnings_summary_week', listRiderPayouts: payoutList('payout_draft') });
    renderEarningsTab(scheme);
    await waitFor(() => expect(screen.getByTestId('earnings-open-activity')).toBeTruthy());
    fireEvent.press(screen.getByTestId('earnings-open-payouts'));
    await waitFor(() => expect(screen.getByTestId('current-route').props.children).toBe('earningsPayouts'));
  });
});
