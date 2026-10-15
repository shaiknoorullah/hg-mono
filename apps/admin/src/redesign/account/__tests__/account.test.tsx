import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { Route } from 'react-router-dom';

import { getToken } from '../../../lib/token';
import { getSession } from '../../data/session';
import { fixture, mockApi, principalFor, renderRedesign, resetSession } from '../../testing';
import AccountRoute from '../AccountRoute';

// The suites run beside other packages' tests before a push; a cold first render can be slow.
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
  resetSession();
});

const render = (role: 'ADMIN' | 'SUPPORT_AGENT' = 'ADMIN') => renderRedesign(<Route path="/account" element={<AccountRoute />} />, { route: '/account', principal: role });
const err = (status: number, code: string) => ({ status, body: { error: { code, message: 'x', request_id: '01JTESTREQUEST0000000000000' } } });
const fill = (current: string, next: string) => {
  fireEvent.change(screen.getByLabelText(/Current password/), { target: { value: current } });
  fireEvent.change(screen.getByLabelText(/New password/), { target: { value: next } });
};

describe('Change password', () => {
  it('sends nothing for a short new password and says what to fix', async () => {
    const api = mockApi();
    render();
    fill('old-password-123', 'short');
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByText('Use at least 12 characters.')).toBeTruthy();
    expect(api.callsTo('changePassword')).toHaveLength(0);
  });

  it('puts a wrong current password on that field and keeps the person signed in (it is a 422, not an expired session)', async () => {
    mockApi({ changePassword: err(422, 'INVALID_CREDENTIALS') });
    render();
    fill('wrong-password-1', 'a-fresh-password-9');
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByText('That isn’t your current password.')).toBeTruthy();
    expect(getSession().ended).toBeNull();
  });

  it('puts a breached password on the new field, and a rate limit as its own message', async () => {
    const api = mockApi({ changePassword: err(422, 'BREACHED_PASSWORD') });
    render();
    fill('old-password-123', 'ramadanmubarak2026');
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByText(/has appeared in a data breach/)).toBeTruthy();
    api.set({ changePassword: { status: 429, body: { error: { code: 'RATE_LIMITED', message: 'x', request_id: '01JTESTREQUEST0000000000000' } }, headers: { 'Retry-After': '120' } } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByText(/Too many tries\. Nothing was changed\./)).toBeTruthy();
  });

  it('on success re-issues this session with the new token and clears the fields', async () => {
    const grant = fixture<{ access_token: string }>('session_grant_password_changed');
    mockApi({ changePassword: 'session_grant_password_changed' });
    render();
    fill('old-password-123', 'a-fresh-password-9');
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    await waitFor(() => expect(getToken()).toBe(grant.access_token));
    expect((screen.getByLabelText(/Current password/) as HTMLInputElement).value).toBe('');
    expect(await screen.findByText('Password changed.')).toBeTruthy();
  });

  it('after no answer, says it was not changed or could not be confirmed, and keeps what was typed', async () => {
    mockApi({ changePassword: err(500, 'INTERNAL_ERROR') });
    render();
    fill('old-password-123', 'a-fresh-password-9');
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByText(/Nothing was sent, or we couldn’t confirm it/)).toBeTruthy();
    expect((screen.getByLabelText(/New password/) as HTMLInputElement).value).toBe('a-fresh-password-9');
  });
});

describe('Sign out everywhere', () => {
  const open = () => fireEvent.click(screen.getByRole('button', { name: /Sign out everywhere…/ }));

  it('asks first, defaults to keeping the session, and sends nothing until confirmed', () => {
    const api = mockApi();
    render();
    open();
    expect(screen.getByText('Sign out everywhere, including here?')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep me signed in' }));
    expect(api.callsTo('logoutAll')).toHaveLength(0);
  });

  it('ends this session when the server confirms', async () => {
    mockApi();
    render();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    await waitFor(() => expect(getSession().principal).toBeNull());
  });

  it('never says it worked or failed when there is no answer, and offers the same request again', async () => {
    const api = mockApi({ logoutAll: err(503, 'SERVICE_UNAVAILABLE') });
    render();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    expect(await screen.findByText('We couldn’t confirm you were signed out everywhere.')).toBeTruthy();
    expect(getSession().principal).not.toBeNull();
    api.set({ logoutAll: undefined });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(getSession().principal).toBeNull());
  });
});

describe('what the page claims', () => {
  it('mentions the authenticator app only for someone who signed in with a code (two-step sign-in is opt-in)', () => {
    renderRedesign(<Route path="/account" element={<AccountRoute />} />, { route: '/account', principal: { ...principalFor('ADMIN'), amr: 'pwd' } });
    expect(screen.queryByText(/Lost your authenticator app/)).toBeNull();
    cleanup();
    render();
    expect(screen.getByText(/Lost your authenticator app/)).toBeTruthy();
  });
});
