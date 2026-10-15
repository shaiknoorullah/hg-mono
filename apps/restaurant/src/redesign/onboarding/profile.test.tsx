/**
 * WP6 — the business profile step (canvas ON `Profile-*`): the whole profile is saved at once, a
 * refusal lands on its fields and in a summary whose links open the right section, and what was
 * typed survives a reload on this device only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { consoleRoutes, fixture, installFakeApi } from '../test/fakeApi';
import { renderRedesign } from '../test/render';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

const profileRoutes = (extra: Record<string, never | object> = {}) =>
  consoleRoutes({
    'GET /v1/restaurant/onboarding/status': 'restaurant_onboarding_profile_pending',
    'GET /v1/restaurant/documents': 'restaurant_document_pack_empty',
    ...extra,
  });

describe('business profile', () => {
  it('saves the whole profile with the cuisines it already holds, and sends nothing the server owns', async () => {
    const saved = fixture('restaurant_profile');
    const api = installFakeApi(profileRoutes({ 'PUT /v1/restaurant/profile': { body: saved } }));
    await renderRedesign('/onboarding');
    fireEvent.click(await screen.findByRole('button', { name: /Save and continue/ }));
    await waitFor(() => expect(api.callsTo('PUT /v1/restaurant/profile')).toHaveLength(1));
    const body = await api.callsTo('PUT /v1/restaurant/profile')[0]!.json();
    expect(body.cuisine_ids).toEqual(fixture('restaurant_profile').cuisine_ids);
    for (const forbidden of ['account_state', 'onboarding_state', 'halal', 'commission_rate_bps', 'id']) expect(body).not.toHaveProperty(forbidden);
    expect(body.phone_e164).toMatch(/^\+1[2-9]\d{9}$/);
  });

  it('puts a refused postal code on its field, in the summary, and the summary link opens that section', async () => {
    installFakeApi(
      profileRoutes({
        'PUT /v1/restaurant/profile': {
          status: 422,
          body: { error: { code: 'VALIDATION_FAILED', message: 'x', request_id: 'r', details: [{ field: 'postal_code', code: 'PROVINCE_NOT_SERVED', message: 'no' }] } },
        },
      }),
    );
    await renderRedesign('/onboarding');
    fireEvent.click(await screen.findByRole('button', { name: /Save and continue/ }));
    const summary = await screen.findByTestId('profile-errors');
    expect(within(summary).getByText('1 field needs changes before we can save')).toBeTruthy();
    fireEvent.click(within(summary).getByRole('link', { name: /Postal code/ }));
    const postal = await screen.findByLabelText('Postal code');
    expect(screen.getByText('This address is outside the area HalalGoes serves. We’re in Ontario at launch.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(postal));
    // What was on screen is still there.
    expect((postal as HTMLInputElement).value).toBe(fixture('restaurant_profile').address.postal_code);
  });

  it('keeps what was typed on this device and says so when the owner comes back', async () => {
    installFakeApi(profileRoutes());
    const first = await renderRedesign('/onboarding');
    fireEvent.change(await screen.findByLabelText('Name customers see'), { target: { value: 'Barakah Grill and Bakery' } });
    first.unmount();
    cleanup();
    installFakeApi(profileRoutes());
    await renderRedesign('/onboarding');
    expect(await screen.findByTestId('profile-returning')).toBeTruthy();
    expect((screen.getByLabelText('Name customers see') as HTMLInputElement).value).toBe('Barakah Grill and Bakery');
  });

  it('keeps the draft for the tab only, never stores the tax number, and sign-out removes it', async () => {
    installFakeApi(profileRoutes({ 'POST /v1/auth/logout': { status: 204 } }));
    await renderRedesign('/onboarding');
    fireEvent.change(await screen.findByLabelText('Name customers see'), { target: { value: 'Barakah Grill and Bakery' } });
    fireEvent.click(screen.getByRole('button', { name: /Tax and time zone/ }));
    fireEvent.change(await screen.findByLabelText('GST/HST number (optional)'), { target: { value: '123456789RT0001' } });
    const keys = Object.keys(sessionStorage).filter((k) => k.startsWith('hg_restaurant_profile_draft'));
    expect(keys).toHaveLength(1);
    expect(sessionStorage.getItem(keys[0]!)).toContain('Barakah Grill and Bakery');
    expect(sessionStorage.getItem(keys[0]!)).not.toContain('123456789RT0001');
    expect(Object.keys(localStorage).some((k) => k.includes('profile_draft'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /^Account/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(Object.keys(sessionStorage).filter((k) => k.includes('profile_draft'))).toHaveLength(0));
  });
});
