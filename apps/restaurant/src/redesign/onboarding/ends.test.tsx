/**
 * WP7 — setup done and the ends and blockers (canvas ON `Onb-Done*`, `Withdrawn`,
 * `App-NotApproved`, `Delisted-Setup`, `Suspended-Setup`): a lapsed halal certificate is slate
 * and "we can't currently vouch", a final decision shows the reviewer's note and offers no
 * upload, and the done page draws a seal only from the profile's own halal data.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { consoleRoutes, fixture, installFakeApi } from '../test/fakeApi';
import { renderRedesign } from '../test/render';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const routes = (onboarding: string, extra: Record<string, never | object | string> = {}) =>
  consoleRoutes({ 'GET /v1/restaurant/onboarding/status': onboarding, 'GET /v1/restaurant/documents': 'restaurant_document_pack_complete', ...extra });

describe('ends and blockers', () => {
  it('a certificate that ended during setup blocks it in slate, says we cannot vouch, and offers the renewal', async () => {
    const profile = fixture('restaurant_profile_halal_expired');
    profile.account_state = 'PENDING';
    installFakeApi(routes('restaurant_onboarding_menu_pending', { 'GET /v1/restaurant/profile': { body: profile } }));
    await renderRedesign('/onboarding');
    const pane = await screen.findByTestId('account-state');
    expect(pane.querySelector('#acct-h')!.textContent).toBe('Your halal certificate has ended');
    expect(pane.textContent).toContain('we can’t currently vouch for it');
    expect(pane.innerHTML).not.toMatch(/danger|feedback-warning/);
    expect(within(pane).queryByText(/listing|hidden/i)).toBeNull();
    fireEvent.click(within(pane).getByRole('button', { name: 'Upload renewed certificate' }));
    expect(await screen.findByTestId('renew-panel')).toBeTruthy();
  });

  it('a final decision shows the reviewer’s note verbatim, plain wording for the code, and no way to upload again', async () => {
    installFakeApi(routes('restaurant_onboarding_application_rejected'));
    await renderRedesign('/onboarding');
    const page = await screen.findByTestId('not-approved');
    expect(within(page).getByText('We couldn’t accept your halal certification')).toBeTruthy();
    expect(within(page).getByTestId('reviewer-note').textContent).toBe(fixture('restaurant_onboarding_application_rejected').rejection.note);
    expect(page.textContent).not.toContain('HALAL_CERTIFICATION_INVALID');
    expect(screen.queryByRole('button', { name: /upload/i })).toBeNull();
  });

  it('a withdrawn application ends setup instead of opening the console', async () => {
    installFakeApi(routes('restaurant_onboarding_withdrawn'));
    await renderRedesign('/orders');
    expect(await screen.findByText('Your application was withdrawn')).toBeTruthy();
  });
});

describe('setup done', () => {
  it('draws the seal from the profile’s halal data, and no seal when there is none', async () => {
    installFakeApi(routes('restaurant_onboarding_active', { 'GET /v1/restaurant/profile': 'restaurant_profile_halal_certified' }));
    await renderRedesign('/onboarding/done');
    const page = await screen.findByTestId('done-screen');
    expect(within(page).getByTestId('HalalBadge')).toBeTruthy();
    expect(within(page).getByText(/Accept each new order within 3 minutes/)).toBeTruthy();
    cleanup();
    installFakeApi(routes('restaurant_onboarding_active', { 'GET /v1/restaurant/profile': 'restaurant_profile_halal_missing' }));
    await renderRedesign('/onboarding/done');
    const again = await screen.findByTestId('done-screen');
    expect(within(again).queryByTestId('HalalBadge')).toBeNull();
  });
});
