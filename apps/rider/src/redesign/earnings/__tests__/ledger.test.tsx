/**
 * R36 Earnings activity (EA/Activity) and R37 Earnings line (EA/EntryDetail), light and dark:
 * loading, empty, error, 429, paused, populated, explicit paging (meta.next_cursor), paging
 * error, end, offline; every entry type and status; the line's payout row (loading, error, 404,
 * loaded). Amounts are the entry's own `gross_cents` / `tip_cents`.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => {
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});

import { reportTransportFailure, resetConnectivity } from '../../data/connectivity';
import { mockApi, payload, type MockApi } from '../../test/mockApi';
import { SCHEMES } from '../../test/render';
import { ACTIVITY, LINE, PAUSED } from '../copy';
import { ENTRY_TITLE, ENTRY_TYPE_WORD, dayLabel, payoutPeriod } from '../format';
import { ACCOUNT_NOT_ACTIVE, money, page, renderRoute } from './harness';

let api: MockApi;
afterEach(() => {
  api?.restore();
  resetConnectivity();
});

type Entry = ReturnType<typeof payload> & { id: string; type: string; status: string; gross_cents: number; tip_cents: number; earned_at: string; payout_id: string | null; order_code: string | null };
const mixed: Entry[] = payload('earning_entries_mixed');
const byType = (t: string): Entry => mixed.find((e) => e.type === t)!;

describe.each(SCHEMES)('Earnings activity (%s)', (scheme) => {
  it('loading shows the skeleton and its status line', () => {
    api = mockApi({ listRiderEarningEntries: 'pending' });
    renderRoute(scheme, 'earningsActivity', undefined);
    expect(screen.getByTestId('activity-skeleton', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText(ACTIVITY.loading)).toBeTruthy();
  });

  it('every line: type, order code, status word, its own gross_cents; a correction not in a payout shows the note', async () => {
    // Derived from earning_entries_mixed: the CLAWBACK not yet in a payout (payout_id null).
    const rows = mixed.map((e) => (e.type === 'CLAWBACK' ? { ...e, payout_id: null } : e));
    api = mockApi({ listRiderEarningEntries: page(rows) });
    renderRoute(scheme, 'earningsActivity', undefined);
    await waitFor(() => expect(screen.getByTestId(`entry-row-${rows[0]!.id}`)).toBeTruthy());
    for (const e of rows) {
      const row = within(screen.getByTestId(`entry-row-${e.id}`));
      expect(row.getByText(ENTRY_TYPE_WORD[e.type as keyof typeof ENTRY_TYPE_WORD])).toBeTruthy();
      expect(row.getByText(money(e.gross_cents, 'always'))).toBeTruthy();
    }
    expect(within(screen.getByTestId(`entry-row-${byType('CLAWBACK').id}`)).getByText('Not in a payout yet')).toBeTruthy();
    expect(within(screen.getByTestId(`entry-row-${byType('ADJUSTMENT').id}`)).getByText('Pending')).toBeTruthy();
    expect(within(screen.getByTestId(`entry-row-${byType('TIP').id}`)).getByText('Paid')).toBeTruthy();
    expect(screen.getByText(dayLabel(rows[0]!.earned_at))).toBeTruthy();
    expect(screen.getByText(ACTIVITY.pending)).toBeTruthy();
    expect(screen.getByText(ACTIVITY.end)).toBeTruthy();
    expect(screen.getByLabelText('Back to Earnings')).toBeTruthy();
  });

  it('pages explicitly with the meta cursor; a failed page keeps the rows; Try again carries on', async () => {
    const [a, b, c] = mixed;
    api = mockApi({
      listRiderEarningEntries: (call, n) => {
        if (!call.query.cursor) return page([a, b], { next_cursor: 'cur-2', has_more: true });
        return n === 1 ? 'error_internal_error' : page([c], { next_cursor: null, has_more: false });
      },
    });
    renderRoute(scheme, 'earningsActivity', undefined);
    await waitFor(() => expect(screen.getByText(ACTIVITY.more)).toBeTruthy());
    expect(screen.queryByText(ACTIVITY.end)).toBeNull();

    fireEvent.press(screen.getByTestId('activity-more'));
    await waitFor(() => expect(screen.getByText(ACTIVITY.moreError.title)).toBeTruthy());
    expect(screen.getByTestId(`entry-row-${a!.id}`)).toBeTruthy();

    fireEvent.press(screen.getByTestId('activity-more-retry'));
    await waitFor(() => expect(screen.getByTestId(`entry-row-${c!.id}`)).toBeTruthy());
    expect(screen.getByText(ACTIVITY.end)).toBeTruthy();
    const older = api.callsTo('listRiderEarningEntries').filter((x) => x.query.cursor);
    expect(older.map((x) => x.query.cursor)).toEqual(['cur-2', 'cur-2']);
  });

  it('empty', async () => {
    api = mockApi({ listRiderEarningEntries: 'earning_entries_empty' });
    renderRoute(scheme, 'earningsActivity', undefined);
    await waitFor(() => expect(screen.getByText(ACTIVITY.empty.title)).toBeTruthy());
    expect(screen.getByText(ACTIVITY.empty.action)).toBeTruthy();
  });

  it('error, then Try again', async () => {
    api = mockApi({ listRiderEarningEntries: (_c, n) => (n === 0 ? 'error_internal_error' : 'earning_entries_mixed') });
    renderRoute(scheme, 'earningsActivity', undefined);
    await waitFor(() => expect(screen.getByText(ACTIVITY.error.title)).toBeTruthy());
    fireEvent.press(screen.getByTestId('activity-error-retry'));
    await waitFor(() => expect(screen.getByTestId(`entry-row-${mixed[0]!.id}`)).toBeTruthy());
  });

  it('429 holds Try again', async () => {
    api = mockApi({ listRiderEarningEntries: 'error_rate_limited' });
    renderRoute(scheme, 'earningsActivity', undefined);
    await waitFor(() => expect(screen.getByText(ACTIVITY.rateLimited.title)).toBeTruthy());
    expect(screen.getByTestId('activity-error-retry').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('403 ACCOUNT_NOT_ACTIVE shows the paused state', async () => {
    api = mockApi({ listRiderEarningEntries: ACCOUNT_NOT_ACTIVE });
    renderRoute(scheme, 'earningsActivity', undefined);
    await waitFor(() => expect(screen.getByText(PAUSED.activity.title)).toBeTruthy());
  });

  it('offline keeps the saved lines and stops paging', async () => {
    api = mockApi({ listRiderEarningEntries: page(mixed.slice(0, 2), { next_cursor: 'cur-2', has_more: true }) });
    renderRoute(scheme, 'earningsActivity', undefined);
    await waitFor(() => expect(screen.getByText(ACTIVITY.more)).toBeTruthy());
    act(() => reportTransportFailure());
    expect(screen.getByTestId('activity-offline')).toBeTruthy();
    expect(screen.queryByText(ACTIVITY.more)).toBeNull();
  });

  it('a row opens its line with "Back to Earnings activity"', async () => {
    api = mockApi({ listRiderEarningEntries: 'earning_entries_mixed', getRiderPayout: 'payout_detail_paid' });
    renderRoute(scheme, 'earningsActivity', undefined);
    await waitFor(() => expect(screen.getByTestId(`entry-row-${mixed[0]!.id}`)).toBeTruthy());
    fireEvent.press(screen.getByTestId(`entry-row-${mixed[0]!.id}`));
    await waitFor(() => expect(screen.getByTestId('current-route').props.children).toBe('earningsLine'));
    expect(screen.getByLabelText('Back to Earnings activity')).toBeTruthy();
  });
});

describe.each(SCHEMES)('Earnings line (%s)', (scheme) => {
  it('a delivery line: tip and total as returned, never a fee worked out on the phone', async () => {
    const e = byType('DELIVERY');
    api = mockApi({ getRiderPayout: 'payout_detail_paid' });
    renderRoute(scheme, 'earningsLine', { entry: e, from: 'activity' });
    expect(screen.getByText(ENTRY_TITLE.DELIVERY)).toBeTruthy();
    expect(screen.getByTestId('line-amount').props.children).toBe(money(e.gross_cents, 'always'));
    expect(screen.getByTestId('line-total').props.children).toBe(money(e.gross_cents, 'always'));
    expect(within(screen.getByTestId('line-breakdown')).getByText(money(e.tip_cents))).toBeTruthy();
    expect(screen.queryByText('Delivery fee')).toBeNull();
    expect(screen.getByText(LINE.footnote)).toBeTruthy();
    expect(screen.getByText(e.order_code!)).toBeTruthy();
    // The payout row comes from a second call.
    expect(screen.getByTestId('line-payout-loading')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(`In payout ${payoutPeriod(payload('payout_detail_paid'))}`)).toBeTruthy());
    expect(api.callsTo('getRiderPayout')[0]!.path).toBe(`/v1/riders/me/payouts/${e.payout_id}`);
    fireEvent.press(screen.getByTestId('line-payout'));
    await waitFor(() => expect(screen.getByTestId('current-route').props.children).toBe('earningsPayout'));
    expect(screen.getByLabelText('Back to Delivery earnings')).toBeTruthy();
  });

  it.each([
    ['TIP', 'The customer added this tip after the delivery. It has been paid out.'],
    ['BONUS', 'HalalGoes added this bonus to your earnings.'],
    ['ADJUSTMENT', 'HalalGoes added this to your earnings.'],
    ['CLAWBACK', 'This corrects an earlier line. Lines are never edited: a correction is always added as a new line.'],
  ])('%s line explains itself', (type, line) => {
    const e = byType(type);
    api = mockApi({ getRiderPayout: 'pending' });
    renderRoute(scheme, 'earningsLine', { entry: e, from: 'payout' });
    expect(screen.getAllByText(ENTRY_TITLE[type as keyof typeof ENTRY_TITLE]).length).toBeGreaterThan(0);
    expect(screen.getByText(line)).toBeTruthy();
    expect(screen.getByLabelText('Back to Payout')).toBeTruthy();
  });

  it('opened from its payout, the payout row goes back to that payout instead of stacking another', async () => {
    const e = byType('DELIVERY');
    api = mockApi({ getRiderPayout: 'payout_detail_paid' });
    renderRoute(scheme, 'earningsPayout', { payoutId: e.payout_id!, from: 'payouts' });
    await waitFor(() => expect(screen.getByTestId('payout-lines')).toBeTruthy());
    const detailEntry = payload('payout_detail_paid').entries[0];
    fireEvent.press(screen.getByTestId(`entry-row-${detailEntry.id}`));
    await waitFor(() => expect(screen.getByTestId('current-route').props.children).toBe('earningsLine'));
    await waitFor(() => expect(screen.getByTestId('line-payout')).toBeTruthy());
    fireEvent.press(screen.getByTestId('line-payout'));
    await waitFor(() => expect(screen.getByTestId('current-route').props.children).toBe('earningsPayout'));
    // Popped back to the payout it came from (its back label is still "Back to Payouts").
    expect(screen.getByLabelText('Back to Payouts')).toBeTruthy();
  });

  it('a reversed tip not in a payout says it will not be paid', () => {
    // Derived from earning_entries_mixed: the PAID tip, reversed before payout.
    const e = { ...byType('TIP'), status: 'REVERSED', payout_id: null };
    api = mockApi();
    renderRoute(scheme, 'earningsLine', { entry: e, from: 'activity' });
    expect(screen.getByText('This tip was reversed before it was paid, so it isn’t paid out.')).toBeTruthy();
    expect(screen.getByTestId('line-no-payout').props.children).toBe(LINE.reversedNo);
    expect(api.callsTo('getRiderPayout')).toHaveLength(0);
  });

  it('a pending line not in a payout yet', () => {
    const e = { ...byType('ADJUSTMENT'), payout_id: null };
    api = mockApi();
    renderRoute(scheme, 'earningsLine', { entry: e, from: 'activity' });
    expect(screen.getByTestId('line-no-payout').props.children).toBe(LINE.notYet);
  });

  it('payout row error, then Try again', async () => {
    api = mockApi({ getRiderPayout: (_c, n) => (n === 0 ? 'error_internal_error' : 'payout_detail_paid') });
    renderRoute(scheme, 'earningsLine', { entry: byType('DELIVERY'), from: 'activity' });
    await waitFor(() => expect(screen.getByText(LINE.payoutError.title)).toBeTruthy());
    fireEvent.press(screen.getByText(LINE.payoutError.action));
    await waitFor(() => expect(screen.getByTestId('line-payout')).toBeTruthy());
  });

  it('payout row 404: "In a payout we can\'t show right now"', async () => {
    api = mockApi({ getRiderPayout: 'error_not_found', listRiderPayouts: 'payout_list_empty' });
    renderRoute(scheme, 'earningsLine', { entry: byType('DELIVERY'), from: 'activity' });
    await waitFor(() => expect(screen.getByText(LINE.payoutMissing.title)).toBeTruthy());
    fireEvent.press(screen.getByText(LINE.payoutMissing.action));
    await waitFor(() => expect(screen.getByTestId('current-route').props.children).toBe('earningsPayouts'));
  });
});
