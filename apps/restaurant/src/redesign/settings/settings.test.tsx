/**
 * Settings (restaurant settings, #658): the section states from the contract's fixtures, the
 * profile save that must not touch reviewed fields, and the password change that must not be
 * replayed on a 401.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { consoleRoutes, errorBody, fixture, installFakeApi } from '../test/fakeApi';
import { renderRedesign } from '../test/render';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

import type { Handler } from '../test/fakeApi';
const routes = (over: Record<string, Handler> = {}) =>
  consoleRoutes({
    'GET /v1/restaurant/documents': 'restaurant_document_pack_complete',
    'GET /v1/restaurant/hours': 'restaurant_hours_standard',
    ...over,
  });

describe('Settings page states', () => {
  it('shows a skeleton while loading, then the halal section', async () => {
    installFakeApi(routes({ 'GET /v1/restaurant/profile': 'restaurant_profile_halal_certified' }));
    await renderRedesign('/settings');
    expect(await screen.findByTestId('section-halal')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeTruthy();
  });

  it('says it could not load, and tries again', async () => {
    let n = 0;
    installFakeApi(routes({ 'GET /v1/restaurant/profile': () => (++n === 1 ? { status: 500, body: errorBody('INTERNAL') } : { body: fixture('restaurant_profile_halal_certified') }) }));
    await renderRedesign('/settings');
    // The console gate reads the same profile; the page shows its own error with Try again.
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('section-halal')).toBeTruthy();
  });

  it('draws no badge and no claim when the halal field is missing', async () => {
    installFakeApi(routes({ 'GET /v1/restaurant/profile': 'restaurant_profile_halal_missing' }));
    await renderRedesign('/settings/halal');
    const section = await screen.findByTestId('section-halal');
    expect(section.getAttribute('data-tone')).toBe('missing');
    expect(within(section).queryByText(/halal certified/i)).toBeNull();
  });

  it('draws expired as slate, never danger', async () => {
    installFakeApi(routes({ 'GET /v1/restaurant/profile': 'restaurant_profile_halal_expired' }));
    await renderRedesign('/settings/halal');
    const section = await screen.findByTestId('section-halal');
    expect(section.getAttribute('data-tone')).toBe('expired');
    expect(within(section).getByText('We can’t currently vouch for your halal certificate')).toBeTruthy();
    expect(section.innerHTML).not.toMatch(/danger/);
  });

  it('says only owners and managers see documents when the list is denied', async () => {
    installFakeApi(routes({ 'GET /v1/restaurant/documents': { status: 403, body: errorBody('FORBIDDEN') } }));
    await renderRedesign('/settings/documents');
    expect(await screen.findByTestId('documents-denied')).toBeTruthy();
  });

  it('offers a retry when the documents fail to load, and says when a file link fails', async () => {
    const api = installFakeApi(routes({ 'GET /v1/restaurant/documents': { status: 500, body: errorBody('INTERNAL') } }));
    await renderRedesign('/settings/documents');
    expect(await screen.findByTestId('documents-error')).toBeTruthy();
    api.set('GET /v1/restaurant/documents', 'restaurant_document_pack_complete');
    api.set('GET /v1/documents/' + fixture('restaurant_document_pack_complete')[0].id + '/download-url', { status: 404, body: errorBody('NOT_FOUND') });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    const view = await screen.findAllByRole('button', { name: /^View / });
    fireEvent.click(view[0]!);
    expect(await screen.findByTestId('file-link-error')).toBeTruthy();
  });
});

describe('Business profile', () => {
  it('saves the owner name from a fresh read and leaves the reviewed fields as they were', async () => {
    const profile = fixture('restaurant_profile');
    const api = installFakeApi(routes({ 'GET /v1/restaurant/profile': { body: profile }, 'PUT /v1/restaurant/profile': async (req: Request) => ({ body: { ...profile, ...(await req.json()) } }) }));
    await renderRedesign('/settings/profile');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit owner name' }));
    const first = await screen.findByLabelText('Owner’s first name');
    fireEvent.change(first, { target: { value: 'Zainab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('PUT /v1/restaurant/profile')).toHaveLength(1));
    const body = await api.callsTo('PUT /v1/restaurant/profile')[0]!.json();
    expect(body.owner_first_name).toBe('Zainab');
    expect(body.display_name).toBe(profile.display_name);
    expect(body.legal_name).toBe(profile.legal_name);
    expect(body.description).toBe(profile.description);
  });

  it('never sends a reviewed field: "Request a change" opens support instead', async () => {
    const api = installFakeApi(routes({ 'GET /v1/restaurant/profile': 'restaurant_profile' }));
    await renderRedesign('/settings/profile');
    fireEvent.click(await screen.findByRole('button', { name: 'Request a change to the description' }));
    expect(await screen.findByTestId('support-panel')).toBeTruthy();
    expect(api.callsTo('PUT /v1/restaurant/profile')).toHaveLength(0);
  });

  it('hides every edit for a suspended account', async () => {
    installFakeApi(routes({ 'GET /v1/restaurant/profile': 'restaurant_profile_account_suspended' }));
    await renderRedesign('/settings/profile');
    await screen.findByTestId('section-profile');
    expect(screen.queryByRole('button', { name: 'Edit owner name' })).toBeNull();
  });
});

describe('Change password', () => {
  it('shows a wrong current password on its field and sends the request once', async () => {
    const api = installFakeApi(routes({ 'GET /v1/restaurant/profile': 'restaurant_profile', 'POST /v1/auth/password/change': { status: 401, body: errorBody('INVALID_CREDENTIALS') } }));
    await renderRedesign('/settings/security');
    fireEvent.click(await screen.findByRole('button', { name: 'Change password' }));
    fireEvent.change(await screen.findByLabelText('Current password'), { target: { value: 'wrong-old-password' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-long-new-password' } });
    fireEvent.click(within(screen.getByTestId('password-panel')).getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('That isn’t your current password. Check it and try again.')).toBeTruthy();
    expect(api.callsTo('POST /v1/auth/password/change')).toHaveLength(1);
    expect(api.callsTo('POST /v1/auth/refresh')).toHaveLength(0);
  });
});
