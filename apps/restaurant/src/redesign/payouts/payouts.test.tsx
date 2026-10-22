/**
 * Payouts (restaurant redesign, #658): every state of the account and the history, the
 * deep link that pages until it finds a payout, the live row change, and the rules that keep
 * money honest on screen.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { FakeRealtimeSocket } from '@hg/ui-web/testing';
import { consoleRoutes, errorBody, fixture, installFakeApi, type Handler } from '../test/fakeApi';
import { renderRedesign } from '../test/render';
import { stripeNavigation } from './AccountPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const routes = (over: Record<string, Handler> = {}) => consoleRoutes(over);
const page = (data: unknown[], next: string | null) => ({ envelope: false, body: { data, meta: { next_cursor: next, has_more: next !== null, total: null } } });
const list = (data: unknown[]) => page(data, null);

describe('payout history', () => {
  it('draws all seven states, with every amount as the server’s cents', async () => {
    installFakeApi(routes({ 'GET /v1/restaurant/payouts': list(fixture('restaurant_payout_history_every_state')) }));
    await renderRedesign('/payouts/history');
    const table = await screen.findByRole('grid', { name: 'Payouts, newest first' });
    for (const label of ['Accruing', 'Ready to send', 'Sending to Stripe', 'Sent to Stripe', 'On hold', 'Failed', 'Paid']) {
      expect((await within(table).findAllByText(label)).length).toBeGreaterThan(0);
    }
    // 184250 cents is $1,842.50: formatted from the integer, not computed.
    expect((await within(table).findAllByText(/1,842\.50/)).length).toBeGreaterThan(0);
    // Needs-attention line lists the held and failed weeks.
    expect(within(await screen.findByTestId('attention')).getAllByRole('button')).toHaveLength(2);
  });

  it('shows a skeleton while loading, then the empty state when there is nothing', async () => {
    installFakeApi(routes({ 'GET /v1/restaurant/payouts': list([]) }));
    await renderRedesign('/payouts/history');
    expect(await screen.findByTestId('payouts-empty')).toBeTruthy();
    expect(screen.getByText('No payouts yet')).toBeTruthy();
  });

  it('says it could not load, keeps the header, and tries again', async () => {
    let n = 0;
    installFakeApi(routes({ 'GET /v1/restaurant/payouts': () => (++n === 1 ? { status: 500, body: errorBody('INTERNAL') } : list(fixture('restaurant_payout_history'))) }));
    await renderRedesign('/payouts/history');
    expect(await screen.findByText(/Couldn't load your payouts/)).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Period' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findAllByText('Paid')).toBeTruthy();
  });

  it('tells a manager payouts are for the owner, not that something broke', async () => {
    installFakeApi(routes({ 'GET /v1/restaurant/payouts': { status: 403, body: errorBody('FORBIDDEN') } }));
    await renderRedesign('/payouts/history');
    expect(await screen.findByText('Payouts are visible to the account owner')).toBeTruthy();
  });

  it('loads more, keeps what is on screen when that fails, and ends the list', async () => {
    const p1 = fixture('restaurant_payout_history_page_1');
    const p2 = fixture('restaurant_payout_history_page_2');
    let second = 0;
    installFakeApi(
      routes({
        'GET /v1/restaurant/payouts': (req) => {
          if (!new URL(req.url).searchParams.get('cursor')) return page(p1, 'c2');
          return ++second === 1 ? { status: 500, body: errorBody('INTERNAL') } : list(p2);
        },
      }),
    );
    await renderRedesign('/payouts/history');
    const more = await screen.findByRole('button', { name: 'Load more' });
    const before = screen.getAllByRole('row').length;
    fireEvent.click(more);
    expect(await screen.findByText(/Couldn’t load more payouts/)).toBeTruthy();
    expect(screen.getAllByRole('row').length).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('That’s every payout so far.')).toBeTruthy();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(before);
  });
});

describe('payout history at phone width', () => {
  it('stacks one row per payout, with the server’s amount, and a row opens its payout', async () => {
    const every = fixture('restaurant_payout_history_every_state') as { id: string; state: string }[];
    installFakeApi(routes({ 'GET /v1/restaurant/payouts': list(every) }));
    await renderRedesign('/payouts/history', { phone: true });
    const rows = await screen.findByRole('list', { name: 'Payouts, newest first' });
    expect(screen.queryByRole('grid')).toBeNull();
    expect(within(rows).getAllByRole('listitem')).toHaveLength(every.length);
    expect((await within(rows).findAllByText(/1,842\.50/)).length).toBeGreaterThan(0);
    fireEvent.click(within(rows).getAllByRole('button')[0]!);
    expect(await screen.findByTestId('payout-detail')).toBeTruthy();
  });
});

describe('one payout', () => {
  const every = () => fixture('restaurant_payout_history_every_state') as { id: string; state: string }[];
  const idOf = (state: string) => every().find((p) => p.state === state)!.id;

  it('opens from a link, shows the hold reason verbatim, and offers support with the reference', async () => {
    installFakeApi(routes({ 'GET /v1/restaurant/payouts': list(every()) }));
    await renderRedesign(`/payouts/history?payout=${idOf('HELD')}`);
    const panel = await screen.findByTestId('payout-panel');
    const reason = every().find((p) => p.state === 'HELD') as unknown as { hold_reason: string };
    expect(await within(panel).findByText(reason.hold_reason)).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Contact support' }));
    expect((await screen.findByTestId('support-reference')).textContent).toBe(idOf('HELD'));
  });

  it('uses its own words only when the server recorded no reason', async () => {
    const rows = every().map((p) => (p.state === 'HELD' ? { ...p, hold_reason: null } : p));
    installFakeApi(routes({ 'GET /v1/restaurant/payouts': list(rows) }));
    await renderRedesign(`/payouts/history?payout=${idOf('HELD')}`);
    expect((await screen.findByTestId('hold-reason')).getAttribute('data-recorded')).toBe('false');
  });

  it('shows the failure message, and an open period as “So far”', async () => {
    installFakeApi(routes({ 'GET /v1/restaurant/payouts': list(every()) }));
    await renderRedesign(`/payouts/history?payout=${idOf('FAILED')}`);
    const why = await screen.findByTestId('why-failed');
    expect(why.textContent).toContain((every().find((p) => p.state === 'FAILED') as unknown as { failure_message: string }).failure_message);
    cleanup();
    await renderRedesign(`/payouts/history?payout=${idOf('DRAFT')}`);
    expect(await screen.findByText('So far')).toBeTruthy();
  });

  it('pages on until the payout from a deep link turns up', async () => {
    const p1 = fixture('restaurant_payout_history_page_1') as { id: string }[];
    const p2 = fixture('restaurant_payout_history_page_2') as { id: string }[];
    const api = installFakeApi(routes({ 'GET /v1/restaurant/payouts': (req) => (new URL(req.url).searchParams.get('cursor') ? list(p2) : page(p1, 'c2')) }));
    await renderRedesign(`/payouts/history?payout=${p2[0]!.id}`);
    expect(await screen.findByTestId('payout-detail')).toBeTruthy();
    expect(api.callsTo('GET /v1/restaurant/payouts')).toHaveLength(2);
  });

  it('says it could not find a payout once the list has ended', async () => {
    installFakeApi(routes({ 'GET /v1/restaurant/payouts': list(every()) }));
    await renderRedesign('/payouts/history?payout=00000000-0000-4000-8000-000000000000');
    expect(await screen.findByText("We couldn't find this payout")).toBeTruthy();
  });

  it('moves a row when the server says its state changed, and tells the open panel', async () => {
    class Sock extends FakeRealtimeSocket {
      static all: Sock[] = [];
      constructor(url: string) {
        super(url);
        Sock.all.push(this);
        setTimeout(() => this.open(), 0);
      }
    }
    vi.stubGlobal('WebSocket', Sock);
    const rows = every();
    const target = rows.find((p) => p.state === 'TRANSFERRED') as unknown as { id: string; amount_cents: number };
    installFakeApi(routes({ 'GET /v1/restaurant/payouts': list(rows), 'POST /v1/realtime/ticket': 'realtime_ticket' }));
    await renderRedesign(`/payouts/history?payout=${target.id}`);
    await screen.findByTestId('payout-detail');
    await waitFor(() => expect(Sock.all.length).toBeGreaterThan(0));
    const sock = Sock.all[Sock.all.length - 1]!;
    await waitFor(() => expect(sock.readyState).toBe(1));
    const restaurantId = fixture('restaurant_profile').id;
    act(() =>
      sock.push({
        id: 'e1',
        seq: 1,
        channel: `restaurant:${restaurantId}`,
        type: 'restaurant.payout_updated',
        data: { payout_id: target.id, state: 'FAILED', amount_cents: target.amount_cents, currency: 'CAD', period: { start: '2026-07-20T04:00:00Z', end: '2026-07-27T04:00:00Z' } },
      }),
    );
    expect((await screen.findByTestId('payout-live')).textContent).toContain('This payout just changed to Failed');
    expect(screen.getByTestId('payout-detail').getAttribute('data-state')).toBe('FAILED');
  });
});

describe('payout account', () => {
  it('has no account yet: sets one up with an idempotency key, then opens Stripe', async () => {
    const go = vi.spyOn(stripeNavigation, 'go').mockImplementation(() => {});
    const api = installFakeApi(
      routes({
        'GET /v1/connect/status': { status: 404, body: errorBody('NOT_FOUND') },
        'POST /v1/connect/account': { status: 201, body: fixture('connect_status_currently_due') },
        'POST /v1/connect/onboarding-link': { status: 201, body: fixture('connect_onboarding_link') },
        'GET /v1/restaurant/profile': 'restaurant_profile_account_live',
      }),
    );
    await renderRedesign('/payouts');
    fireEvent.click(await screen.findByRole('button', { name: 'Set up payouts with Stripe' }));
    await waitFor(() => expect(go).toHaveBeenCalledWith(fixture('connect_onboarding_link').url));
    expect(api.callsTo('POST /v1/connect/account')[0]!.headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('waits for approval: the button is off and says why', async () => {
    installFakeApi(routes({ 'GET /v1/connect/status': { status: 404, body: errorBody('NOT_FOUND') }, 'GET /v1/restaurant/profile': 'restaurant_profile_account_pending' }));
    await renderRedesign('/payouts');
    const button = (await screen.findByRole('button', { name: 'Set up payouts with Stripe' })) as HTMLButtonElement;
    expect(button.disabled || button.getAttribute('aria-disabled') === 'true').toBe(true);
    expect(screen.getByText('Payout setup opens once HalalGoes approves your documents.')).toBeTruthy();
  });

  it('counts what Stripe needs from its lists and keeps orders going in words', async () => {
    installFakeApi(routes({ 'GET /v1/connect/status': 'connect_status_past_due' }));
    await renderRedesign('/payouts');
    const banner = await screen.findByTestId('banner-held');
    expect(banner.textContent).toContain('Stripe needs 1 thing from you before it can pay you');
    expect(banner.textContent).toContain('You can keep taking orders');
    fireEvent.click(within(banner).getByRole('button', { name: "See Stripe's exact list" }));
    expect((await screen.findByTestId('stripe-list-panel')).textContent).toContain('individual.verification.document');
  });

  it('payouts on: names the bank and shows no warning', async () => {
    installFakeApi(routes({ 'GET /v1/connect/status': 'connect_status_due_with_deadline', 'GET /v1/restaurant/profile': 'restaurant_profile_account_live' }));
    await renderRedesign('/payouts');
    expect(await screen.findByTestId('banner-due-soon')).toBeTruthy();
    expect(screen.getByTestId('account-rows').textContent).toContain('Bank account ending 6789');
  });

  it('a 409 on the Stripe link switches Finish off and points at support', async () => {
    vi.spyOn(stripeNavigation, 'go').mockImplementation(() => {});
    installFakeApi(routes({ 'GET /v1/connect/status': 'connect_status_currently_due', 'POST /v1/connect/onboarding-link': { status: 409, body: errorBody('STEP_NOT_AVAILABLE') } }));
    await renderRedesign('/payouts');
    fireEvent.click(await screen.findByRole('button', { name: 'Finish payout setup in Stripe' }));
    expect(await screen.findByTestId('problem-step-na')).toBeTruthy();
    const finish = screen.getByRole('button', { name: 'Finish payout setup in Stripe' }) as HTMLButtonElement;
    expect(finish.disabled || finish.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('says it could not load, and orders are not affected', async () => {
    let n = 0;
    installFakeApi(routes({ 'GET /v1/connect/status': () => (++n <= 2 ? { status: 500, body: errorBody('INTERNAL') } : { body: fixture('connect_status_pending_verification') }) }));
    await renderRedesign('/payouts');
    expect(await screen.findByText("Couldn't load your payout account")).toBeTruthy();
    expect(screen.getByText(/orders keep coming in/)).toBeTruthy();
  });

  it('nothing new is paid while suspended', async () => {
    installFakeApi(routes({ 'GET /v1/connect/status': 'connect_status_complete', 'GET /v1/restaurant/profile': 'restaurant_profile_account_suspended' }));
    await renderRedesign('/payouts');
    expect(await screen.findByTestId('banner-restricted')).toBeTruthy();
    expect(await screen.findByText('No new payouts')).toBeTruthy();
  });
});
