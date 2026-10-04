import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { TOKEN, TWELVE_HOUR, apiError, installDomShims, json, openAddress, scriptFetch } from './linkPageHarness';

/** `/reset-password` on the admin console (issue #329): forgot password, and the emailed link. */
const password = () => screen.getByLabelText(/^New password/) as HTMLInputElement;

async function mount(address: string) {
  openAddress(address);
  const { Root } = await import('../src/App');
  render(<Root />);
}

describe('admin /reset-password', () => {
  beforeAll(installDomShims);

  afterEach(() => {
    cleanup();
    openAddress('/');
  });

  it('is linked from the sign-in gate', async () => {
    await mount('/');
    const link = screen.getByRole('link', { name: 'Reset it by email' });
    expect(link.getAttribute('href')).toBe('/reset-password');
  });

  it('asks for a link without saying whether the account exists', async () => {
    const calls = scriptFetch({ '/v1/auth/password/forgot': json(200, { data: { acknowledged: true } }) });
    await mount('/reset-password');
    fireEvent.change(screen.getByRole('textbox', { name: 'Work email' }), { target: { value: 'zainab@halalgoes.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a reset link' }));

    expect(await screen.findByRole('heading', { name: 'Check your email' })).not.toBeNull();
    expect(screen.getByText(/has a HalalGoes staff account/)).not.toBeNull();
    expect(calls.find((c) => c.path === '/v1/auth/password/forgot')!.body).toEqual({ email: 'zainab@halalgoes.com' });
  });

  it('sets the new password from the emailed link, and the token leaves the address', async () => {
    const calls = scriptFetch({ '/v1/auth/password/reset': json(204) });
    await mount(`/reset-password?token=${TOKEN}`);
    await waitFor(() => expect(window.location.search).toBe(''));

    fireEvent.change(password(), { target: { value: 'kettle-orchard-violet-41' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    expect(await screen.findByRole('heading', { name: 'Your new password is set' })).not.toBeNull();
    expect(calls.find((c) => c.path === '/v1/auth/password/reset')!.body).toEqual({
      token: TOKEN,
      new_password: 'kettle-orchard-violet-41',
    });
  });

  it('on an expired or used link, offers a new one', async () => {
    scriptFetch({ '/v1/auth/password/reset': apiError(400, 'TOKEN_CONSUMED') });
    await mount(`/reset-password?token=${TOKEN}`);
    fireEvent.change(password(), { target: { value: 'kettle-orchard-violet-41' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    expect(await screen.findByRole('heading', { name: "This link doesn't work any more" })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Email me a new link' }));
    expect(screen.getByRole('heading', { name: 'Reset your password' })).not.toBeNull();
  });

  it('on a 429, holds the button and names a 12-hour time', async () => {
    scriptFetch({ '/v1/auth/password/reset': apiError(429, 'RATE_LIMITED', { 'Retry-After': '60' }) });
    await mount(`/reset-password?token=${TOKEN}`);
    fireEvent.change(password(), { target: { value: 'kettle-orchard-violet-41' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    expect(await screen.findByText('Too many attempts from this device')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Set new password' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(/You can try again at/).textContent).toMatch(TWELVE_HOUR);
  });
});
