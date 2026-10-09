/**
 * R38 Payouts (EA/Payouts) and R39 Payout (EA/PayoutDetail, EA/PayoutStates), light and dark.
 * Every PayoutState is rendered from its fixture, in the list and on the payout page; amounts
 * are each payout's own `amount_cents`.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Linking } from 'react-native';

jest.mock('react-native-safe-area-context', () => {
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});

import { reportTransportFailure, resetConnectivity } from '../../data/connectivity';
import { mockApi, payload, type MockApi } from '../../test/mockApi';
import { SCHEMES } from '../../test/render';
import { NEXT, PAUSED, PAYOUT, PAYOUTS } from '../copy';
import { PAYOUT_STATE_WORD, dayLabel, payoutPeriod, payoutPeriodLong, payoutRowSub, type PayoutState } from '../format';
import { ACCOUNT_NOT_ACTIVE, money, ok, page, payoutList, renderRoute } from './harness';

let api: MockApi;
afterEach(() => {
  api?.restore();
  resetConnectivity();
  jest.restoreAllMocks();
});

const STATES: [PayoutState, string][] = [
  ['DRAFT', 'payout_draft'],
  ['READY', 'payout_ready'],
  ['TRANSFERRING', 'payout_transferring'],
  ['TRANSFERRED', 'payout_transferred'],
  ['PAID', 'payout_paid'],
  ['FAILED', 'payout_failed'],
  ['HELD', 'payout_held'],
];

/** A PayoutDetail for a state: the per-state payout fixture plus `payout_detail_paid`'s entries. */
function detail(scenario: string, over: Record<string, unknown> = {}) {
  return ok({ ...payload(scenario), entries: payload('payout_detail_paid').entries, ...over });
}

const needsInfo = ok({
  ...payload('connect_status_complete'),
  requirements: { ...payload('connect_status_complete').requirements, currently_due: ['external_account'] },
});

describe.each(SCHEMES)('Payouts (%s)', (scheme) => {
  it('every payout state is a row with its period, line count, word and own amount', async () => {
    api = mockApi({ listRiderPayouts: payoutList(...STATES.map(([, s]) => s)), getRiderEarningsSummary: 'earnings_summary_week' });
    renderRoute(scheme, 'earningsPayouts', undefined);
    await waitFor(() => expect(screen.getByTestId('payouts-row-DRAFT')).toBeTruthy());
    for (const [state, scenario] of STATES) {
      const p = payload(scenario);
      const row = within(screen.getByTestId(`payouts-row-${state}`));
      expect(row.getByText(payoutPeriod(p))).toBeTruthy();
      expect(row.getByText(payoutRowSub(p))).toBeTruthy();
      expect(row.getByText(PAYOUT_STATE_WORD[state])).toBeTruthy();
      expect(row.getByText(money(p.amount_cents))).toBeTruthy();
    }
    // Summary card: next payout = the DRAFT's own amount; unpaid = the summary's field.
    expect(screen.getByTestId('earnings-next-amount').props.children).toBe(money(payload('payout_draft').amount_cents));
    expect(screen.getByText(/^Next payout, /)).toBeTruthy();
    expect(screen.getByTestId('earnings-unpaid-amount').props.children).toBe(money(payload('earnings_summary_week').unpaid_balance_cents));
    expect(screen.getByText(PAYOUTS.schedule)).toBeTruthy();
    expect(screen.getByText(PAYOUTS.end)).toBeTruthy();
    expect(screen.getByLabelText('Back to Earnings')).toBeTruthy();
    // Two problem payouts: one banner, one Fix (connect status needs nothing here, so no Fix).
    expect(screen.getByText('Two payouts need attention')).toBeTruthy();
    expect(api.calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('loading', () => {
    api = mockApi({ listRiderPayouts: 'pending' });
    renderRoute(scheme, 'earningsPayouts', undefined);
    expect(screen.getByText(PAYOUTS.loading)).toBeTruthy();
  });

  it('nothing earned: "No payouts yet" with Go to Home', async () => {
    api = mockApi({ listRiderPayouts: 'payout_list_empty', getRiderEarningsSummary: 'earnings_summary_zero' });
    renderRoute(scheme, 'earningsPayouts', undefined);
    await waitFor(() => expect(screen.getByTestId('payouts-empty')).toBeTruthy());
    expect(screen.getByText(PAYOUTS.empty.action)).toBeTruthy();
  });

  it('earned but no payout yet: the first payout date and See earnings activity', async () => {
    api = mockApi({ listRiderPayouts: 'payout_list_empty', getRiderEarningsSummary: 'earnings_summary_week' });
    renderRoute(scheme, 'earningsPayouts', undefined);
    await waitFor(() => expect(screen.getByTestId('payouts-first-payout')).toBeTruthy());
    // The summary card stays above the empty state (EA Payouts-first-payout): the unpaid balance
    // as returned and when the first payout goes, never "Nothing is waiting to be paid".
    const week = payload('earnings_summary_week');
    expect(screen.getByTestId('earnings-unpaid-amount').props.children).toBe(money(week.unpaid_balance_cents));
    expect(screen.getByText(PAYOUTS.firstPayout.noNext(dayLabel(week.next_payout_at)))).toBeTruthy();
    expect(screen.queryByText(NEXT.nothing)).toBeNull();
    fireEvent.press(screen.getByText(PAYOUTS.firstPayout.action));
    await waitFor(() => expect(screen.getByTestId('current-route').props.children).toBe('earningsActivity'));
    expect(screen.getByLabelText('Back to Payouts')).toBeTruthy();
  });

  it.each([
    ['error_internal_error', PAYOUTS.error.title],
    ['error_rate_limited', PAYOUTS.rateLimited.title],
    ['offline', PAYOUTS.offline.title],
  ])('%s', async (scenario, title) => {
    api = mockApi({ listRiderPayouts: scenario });
    renderRoute(scheme, 'earningsPayouts', undefined);
    await waitFor(() => expect(screen.getByText(title)).toBeTruthy());
  });

  it('403 ACCOUNT_NOT_ACTIVE shows the paused state', async () => {
    api = mockApi({ listRiderPayouts: ACCOUNT_NOT_ACTIVE, getRiderEarningsSummary: ACCOUNT_NOT_ACTIVE });
    renderRoute(scheme, 'earningsPayouts', undefined);
    await waitFor(() => expect(screen.getByText(PAUSED.payouts.title)).toBeTruthy());
  });

  it('pages with "Show older payouts"; a failed page keeps the rows', async () => {
    api = mockApi({
      getRiderEarningsSummary: 'earnings_summary_week',
      listRiderPayouts: (call, n) => {
        if (!call.query.cursor) return page([payload('payout_draft')], { next_cursor: 'p-2', has_more: true });
        return n === 1 ? 'error_internal_error' : page([payload('payout_paid')]);
      },
    });
    renderRoute(scheme, 'earningsPayouts', undefined);
    await waitFor(() => expect(screen.getByText(PAYOUTS.more)).toBeTruthy());
    fireEvent.press(screen.getByTestId('payouts-more'));
    await waitFor(() => expect(screen.getByText(PAYOUTS.moreError.title)).toBeTruthy());
    expect(screen.getByTestId('payouts-row-DRAFT')).toBeTruthy();
    fireEvent.press(screen.getByTestId('payouts-more-retry'));
    await waitFor(() => expect(screen.getByTestId('payouts-row-PAID')).toBeTruthy());
    expect(screen.getByText(PAYOUTS.end)).toBeTruthy();
  });

  it('offline with a saved list: the banner, and older payouts wait for the network', async () => {
    api = mockApi({ getRiderEarningsSummary: 'earnings_summary_week', listRiderPayouts: page([payload('payout_draft')], { next_cursor: 'p-2', has_more: true }) });
    renderRoute(scheme, 'earningsPayouts', undefined);
    await waitFor(() => expect(screen.getByText(PAYOUTS.more)).toBeTruthy());
    act(() => reportTransportFailure());
    expect(screen.getByTestId('payouts-offline')).toBeTruthy();
    expect(screen.getByText(PAYOUTS.moreOffline)).toBeTruthy();
  });

  it('a row opens its payout with "Back to Payouts"', async () => {
    api = mockApi({ listRiderPayouts: payoutList('payout_paid'), getRiderEarningsSummary: 'earnings_summary_week', getRiderPayout: 'payout_detail_paid' });
    renderRoute(scheme, 'earningsPayouts', undefined);
    await waitFor(() => expect(screen.getByTestId('payouts-row-PAID')).toBeTruthy());
    fireEvent.press(screen.getByTestId('payouts-row-PAID'));
    await waitFor(() => expect(screen.getByTestId('payout-amount')).toBeTruthy());
    expect(screen.getByLabelText('Back to Payouts')).toBeTruthy();
  });
});

describe.each(SCHEMES)('Payout (%s)', (scheme) => {
  it.each(STATES)('%s renders from its fixture', async (state, scenario) => {
    const p = payload(scenario);
    api = mockApi({ getRiderPayout: detail(scenario), getConnectStatus: 'connect_status_complete' });
    renderRoute(scheme, 'earningsPayout', { payoutId: p.id, from: 'payouts' });
    await waitFor(() => expect(screen.getByTestId('payout-amount')).toBeTruthy());
    expect(screen.getByTestId('payout-amount').props.children).toBe(money(p.amount_cents));
    expect(screen.getByTestId('payout-state').props.children).toBe(PAYOUT_STATE_WORD[state]);
    expect(screen.getAllByText(payoutPeriodLong(p)).length).toBeGreaterThan(0);
    expect(screen.getByText(p.id)).toBeTruthy();
    if (state === 'FAILED') {
      expect(screen.getByTestId('payout-problem-FAILED')).toBeTruthy();
      expect(screen.getByText(PAYOUT.returned.title(p.entry_count))).toBeTruthy();
    } else if (state === 'HELD') {
      expect(screen.getByTestId('payout-problem-HELD')).toBeTruthy();
      expect(screen.getByText(/Reason given: Hold Reason/)).toBeTruthy();
      expect(screen.getByText(/When the hold is lifted, this shows Scheduled\./)).toBeTruthy();
    } else {
      expect(screen.getByTestId(`payout-calm-${state}`)).toBeTruthy();
      expect(screen.getByText(PAYOUT.linesHeading)).toBeTruthy();
    }
    // connect_status_complete needs nothing: no Fix anywhere.
    expect(screen.queryByText(PAYOUT.fix)).toBeNull();
    expect(api.callsTo('getRiderPayout')[0]!.path).toBe(`/v1/riders/me/payouts/${p.id}`);
  });

  it('every line is the entry’s own gross_cents, and opens with "Back to Payout"', async () => {
    const d = payload('payout_detail_paid');
    api = mockApi({ getRiderPayout: 'payout_detail_paid' });
    renderRoute(scheme, 'earningsPayout', { payoutId: d.id, from: 'payouts' });
    await waitFor(() => expect(screen.getByTestId('payout-lines')).toBeTruthy());
    for (const e of d.entries) expect(within(screen.getByTestId(`entry-row-${e.id}`)).getByText(money(e.gross_cents, 'always'))).toBeTruthy();
    expect(screen.getByText(PAYOUT.linesNote)).toBeTruthy();
    fireEvent.press(screen.getByTestId(`entry-row-${d.entries[0].id}`));
    await waitFor(() => expect(screen.getByTestId('current-route').props.children).toBe('earningsLine'));
    expect(screen.getByLabelText('Back to Payout')).toBeTruthy();
  });

  it('more than four lines: "Show all N lines" expands in place, no request', async () => {
    const d = payload('payout_detail_paid');
    const entries = [...d.entries, ...d.entries.map((e: { id: string }, i: number) => ({ ...e, id: `${e.id.slice(0, -1)}${i}` }))];
    api = mockApi({ getRiderPayout: ok({ ...d, entries }) });
    renderRoute(scheme, 'earningsPayout', { payoutId: d.id, from: 'payouts' });
    await waitFor(() => expect(screen.getByText(`Show all ${entries.length} lines`)).toBeTruthy());
    const calls = api.calls.length;
    fireEvent.press(screen.getByTestId('payout-show-all'));
    expect(screen.getByText(`Showing all ${entries.length} lines`)).toBeTruthy();
    expect(api.calls.length).toBe(calls);
  });

  it('no lines: "We can\'t show the lines in this payout right now."', async () => {
    api = mockApi({ getRiderPayout: detail('payout_paid', { entries: [] }) });
    renderRoute(scheme, 'earningsPayout', { payoutId: payload('payout_paid').id, from: 'payouts' });
    await waitFor(() => expect(screen.getByText(PAYOUT.noLines.title)).toBeTruthy());
  });

  it('a failed payout Stripe needs fixing: reason word for word and the sticky Fix opens Stripe', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    api = mockApi({
      getRiderPayout: detail('payout_failed', { failure_message: 'The bank account has been closed.' }),
      getConnectStatus: needsInfo,
      createConnectOnboardingLink: { status: 201, body: { data: { url: 'https://connect.stripe.com/setup/x', expires_at: '2026-10-09T12:00:00Z' } } },
    });
    renderRoute(scheme, 'earningsPayout', { payoutId: payload('payout_failed').id, from: 'payouts' });
    await waitFor(() => expect(screen.getByText(PAYOUT.fix)).toBeTruthy());
    expect(screen.getByText(/Reason given: The bank account has been closed\./)).toBeTruthy();
    expect(screen.getByText(/Fix it first, or the next payout won’t go through either\./)).toBeTruthy();
    fireEvent.press(screen.getByTestId('payout-fix'));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://connect.stripe.com/setup/x'));
    expect(api.callsTo('createConnectOnboardingLink')[0]!.body).toBeUndefined();
  });

  it('a held payout with nothing to fix says so, no Fix', async () => {
    api = mockApi({ getRiderPayout: detail('payout_held'), getConnectStatus: 'connect_status_complete' });
    renderRoute(scheme, 'earningsPayout', { payoutId: payload('payout_held').id, from: 'payouts' });
    await waitFor(() => expect(screen.getByText(/Your payout account needs nothing from you right now\./)).toBeTruthy());
    expect(screen.queryByText(PAYOUT.fix)).toBeNull();
  });

  it('loading', () => {
    api = mockApi({ getRiderPayout: 'pending' });
    renderRoute(scheme, 'earningsPayout', { payoutId: payload('payout_paid').id, from: 'payouts' });
    expect(screen.getByText(PAYOUT.loading)).toBeTruthy();
  });

  it.each([
    ['error_internal_error', PAYOUT.error.title],
    ['error_rate_limited', PAYOUT.rateLimited.title],
    ['offline', PAYOUT.offline.title],
    ['error_not_found', PAYOUT.notFound.title],
  ])('%s', async (scenario, title) => {
    api = mockApi({ getRiderPayout: scenario, listRiderPayouts: 'payout_list_empty' });
    renderRoute(scheme, 'earningsPayout', { payoutId: payload('payout_paid').id, from: 'line', backTitle: 'Tip' });
    await waitFor(() => expect(screen.getByText(title)).toBeTruthy());
    expect(screen.getByLabelText('Back to Tip')).toBeTruthy();
  });

  it('403 ACCOUNT_NOT_ACTIVE shows the paused state', async () => {
    api = mockApi({ getRiderPayout: ACCOUNT_NOT_ACTIVE });
    renderRoute(scheme, 'earningsPayout', { payoutId: payload('payout_paid').id, from: 'payouts' });
    await waitFor(() => expect(screen.getByText(PAUSED.payout.title)).toBeTruthy());
  });
});
