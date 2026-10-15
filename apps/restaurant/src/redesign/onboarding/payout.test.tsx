/**
 * WP7 — payout setup (canvas ON `Payout-*`): the connected account is created once even across
 * a retry, the owner is sent to the link Stripe gave, and Stripe's own status is what the page
 * reports.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { consoleRoutes, errorBody, fixture, installFakeApi } from '../test/fakeApi';
import { renderRedesign } from '../test/render';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const payoutRoutes = (extra: Record<string, never | object> = {}) =>
  consoleRoutes({ 'GET /v1/restaurant/onboarding/status': 'restaurant_onboarding_payout_pending', 'GET /v1/restaurant/documents': 'restaurant_document_pack_complete', ...extra });

describe('payout setup', () => {
  it('makes the Stripe account once, reuses the key on a retry, then opens the link Stripe gave', async () => {
    const assign = vi.fn();
    let created = 0;
    const api = installFakeApi(
      payoutRoutes({
        'GET /v1/connect/status': { status: 404, body: errorBody('NOT_FOUND') },
        'POST /v1/connect/account': () => {
          created += 1;
          return created === 1 ? { status: 503, body: errorBody('SERVICE_UNAVAILABLE') } : { status: 201, body: fixture('connect_status_details_not_submitted') };
        },
        'POST /v1/connect/onboarding-link': { status: 201, body: fixture('connect_onboarding_link') },
      }),
    );
    await renderRedesign('/onboarding');
    vi.stubGlobal('location', { ...window.location, assign });
    fireEvent.click(await screen.findByRole('button', { name: 'Set up payouts with Stripe' }));
    expect(await screen.findByText('We couldn’t set up your Stripe account')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(fixture('connect_onboarding_link').url));
    const [first, second] = api.callsTo('POST /v1/connect/account');
    expect(second!.headers.get('Idempotency-Key')).toBe(first!.headers.get('Idempotency-Key'));
  });

  it('says what Stripe needs in plain words with the raw name beside it, and an unknown one in a fallback sentence', async () => {
    const due = fixture('connect_status_details_not_submitted');
    due.requirements.currently_due = ['external_account', 'something.new'];
    installFakeApi(payoutRoutes({ 'GET /v1/connect/status': { body: due } }));
    await renderRedesign('/onboarding');
    const kv = await screen.findByTestId('payout-kv');
    expect(kv).toBeTruthy();
    expect(screen.getByText('Your bank account for payouts')).toBeTruthy();
    expect(screen.getByText('Stripe needs more details. Continue on Stripe to see what')).toBeTruthy();
    expect(screen.getByText('something.new').tagName).toBe('CODE');
    expect(within(screen.getByTestId('needed-now')).getByText('Stripe needs more details before it can turn on payouts.')).toBeTruthy();
  });

  it('back from Stripe with payouts on: confirms it, then opens the step the server names', async () => {
    let on = false;
    installFakeApi(
      payoutRoutes({
        'GET /v1/restaurant/onboarding/status': () => ({ body: fixture(on ? 'restaurant_onboarding_menu_pending' : 'restaurant_onboarding_payout_pending') }),
        'GET /v1/connect/status': { body: fixture('connect_status_complete') },
        'GET /v1/restaurant/menu': { body: { categories: [] } },
        'GET /v1/restaurant/hours': { body: { timezone: 'America/Toronto', intervals: [], overrides: [] } },
      }),
    );
    await renderRedesign('/onboarding/payout/return');
    expect(await screen.findByText('Payouts are on. Taking you to your first menu…')).toBeTruthy();
    on = true;
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByTestId('rail-current-step').textContent).toBe('First menu and opening hours'));
  });
});
