import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { TOKEN, apiError, installDomShims, json, openAddress, scriptFetch } from './linkPageHarness';

/**
 * `/accept-invite?token=…` (issue #329): the staff invitation link. Until the invitation flow
 * of #170 exists it sets the first password through `resetPassword` (#350), so it is step 1
 * of 2 only.
 */
const password = () => screen.getByLabelText(/^New password/) as HTMLInputElement;

async function mount(address: string) {
  openAddress(address);
  const { Root } = await import('../src/App');
  render(<Root />);
}

function choose(value: string) {
  fireEvent.change(password(), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('admin /accept-invite', () => {
  beforeAll(installDomShims);

  afterEach(() => {
    cleanup();
    openAddress('/');
  });

  it('opens without signing in, removes the token from the address, and sets the first password', async () => {
    const calls = scriptFetch({ '/v1/auth/password/reset': json(204) });
    await mount(`/accept-invite?token=${TOKEN}`);

    expect(screen.getByRole('heading', { name: 'Set up your HalalGoes admin account' })).not.toBeNull();
    expect(screen.getByText('Step 1 of 2')).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Admin sign in' })).toBeNull();
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(window.location.pathname).toBe('/accept-invite');

    choose('kettle-orchard-violet-41');

    expect(await screen.findByRole('heading', { name: 'Your password is set' })).not.toBeNull();
    const reset = calls.find((c) => c.path === '/v1/auth/password/reset')!;
    expect(reset.body).toEqual({ token: TOKEN, new_password: 'kettle-orchard-violet-41' });
    expect(calls.every((c) => !c.url.includes(TOKEN))).toBe(true);
  });

  it('refuses a short password on this device', async () => {
    const calls = scriptFetch({});
    await mount(`/accept-invite?token=${TOKEN}`);
    choose('salaam123');
    expect(await screen.findByText('Use at least 12 characters. This one has 9.')).not.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('says a breached password is not safe', async () => {
    scriptFetch({ '/v1/auth/password/reset': apiError(422, 'BREACHED_PASSWORD') });
    await mount(`/accept-invite?token=${TOKEN}`);
    choose('ramadanmubarak2026');
    expect(await screen.findByText(/has appeared in a data breach, so it isn't safe/)).not.toBeNull();
  });

  it('on an expired or used invite, says so and changes nothing', async () => {
    scriptFetch({ '/v1/auth/password/reset': apiError(400, 'TOKEN_CONSUMED') });
    await mount(`/accept-invite?token=${TOKEN}`);
    choose('kettle-orchard-violet-41');
    expect(await screen.findByRole('heading', { name: "This invite link doesn't work any more" })).not.toBeNull();
  });

  it('on a dropped connection, keeps the password and says the link is unused', async () => {
    scriptFetch({ '/v1/auth/password/reset': new TypeError('Failed to fetch') });
    await mount(`/accept-invite?token=${TOKEN}`);
    choose('kettle-orchard-violet-41');
    expect(await screen.findByText("We couldn't reach HalalGoes")).not.toBeNull();
    expect(password().value).toBe('kettle-orchard-violet-41');
    expect(screen.getByRole('button', { name: 'Try again' })).not.toBeNull();
  });

  it('treats a missing token as a link that does not work', async () => {
    const calls = scriptFetch({});
    await mount('/accept-invite');
    expect(screen.getByRole('heading', { name: "This invite link doesn't work" })).not.toBeNull();
    expect(calls).toHaveLength(0);
  });
});
