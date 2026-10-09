import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { captureLinkToken } from '@hg/ui-web/link-token';

import { fixture, mockApi, renderRedesign, resetSession, type MockApi } from '../../testing';
import { AcceptInviteScreen } from '..';

const TOKEN = 'inV1te7oken_abcdefghijklmnopqrstuvwxyz-0123';
const GOOD = 'kettle-orchard-violet-41';
const LINK_PATHS = ['/reset-password', '/accept-invite'];

function openLink(token: string | null) {
  window.history.replaceState(null, '', token === null ? '/accept-invite' : `/accept-invite?token=${token}`);
  captureLinkToken(LINK_PATHS);
}

function render() {
  return renderRedesign(<AcceptInviteScreen />, { signedIn: false });
}

const passwordField = () => screen.getByLabelText(/^New password/, { selector: 'input' }) as HTMLInputElement;
const continueButton = () => screen.getByRole('button', { name: /^Continue/ });

function choose(password = GOOD) {
  fireEvent.change(passwordField(), { target: { value: password } });
  fireEvent.click(continueButton());
}

let api: MockApi;
beforeEach(() => {
  api = mockApi({ resetPassword: { status: 204 } });
});

afterEach(() => {
  cleanup();
  resetSession();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  captureLinkToken(LINK_PATHS);
});

describe('AcceptInviteScreen', () => {
  it('no token: the invite link does not work, and nothing is sent', () => {
    openLink(null);
    render();
    expect(screen.getByRole('heading', { level: 1, name: 'This invite link doesn’t work' })).toBeTruthy();
    expect(
      screen.getByText(
        'It may be incomplete or mistyped. Open it again from the invite email. If it still doesn’t work, ask the super admin who invited you for a new one.',
      ),
    ).toBeTruthy();
    expect(api.calls).toHaveLength(0);
  });

  it('a malformed token is the same page', () => {
    openLink('abc');
    render();
    expect(screen.getByRole('heading', { level: 1, name: 'This invite link doesn’t work' })).toBeTruthy();
  });

  describe('with a link', () => {
    beforeEach(() => openLink(TOKEN));

    it('set password: step 1 only, no step indicator, no promise of two-step set-up (D1), nothing prefilled (G-AUTH-2)', () => {
      expect(window.location.search).toBe('');
      render();
      expect(screen.getByRole('heading', { level: 1, name: 'Set up your HalalGoes admin account' })).toBeTruthy();
      expect(screen.queryByText(/Step 1 of 2/)).toBeNull();
      expect(screen.queryByText(/two-step/i)).toBeNull();
      expect(screen.queryByLabelText(/^Work email/)).toBeNull();
      expect(
        screen.getByText('At least 12 characters. We check it against passwords exposed in data breaches.'),
      ).toBeTruthy();
      expect(continueButton()).toBeTruthy();
      // Phone widths: the page pads 16px and nothing has a fixed width wider than the card.
      expect(document.querySelector('main')?.className).toContain('px-4');
    });

    it('too short: checked on this device, focus stays on the password field', async () => {
      render();
      choose('salaam123');
      expect(await screen.findByText('Use at least 12 characters. This one has 9.')).toBeTruthy();
      expect(passwordField().getAttribute('aria-invalid')).toBe('true');
      await waitFor(() => expect(document.activeElement).toBe(passwordField()));
      expect(api.callsTo('resetPassword')).toHaveLength(0);
    });

    it('breached (422)', async () => {
      api.set({ resetPassword: 'error_breached_password' });
      render();
      choose('ramadanmubarak2026');
      expect(
        await screen.findByText(
          'This password has appeared in a data breach, so it isn’t safe. Choose a different one of at least 12 characters.',
        ),
      ).toBeTruthy();
      expect(passwordField().getAttribute('aria-invalid')).toBe('true');
    });

    it('saving: Continue is busy and the field read-only', async () => {
      api.set({ resetPassword: { pending: true } });
      render();
      choose();
      await waitFor(() => expect(continueButton().getAttribute('aria-busy')).toBe('true'));
      expect(passwordField().readOnly).toBe(true);
    });

    it('offline: the password is kept and Continue waits for the connection', async () => {
      render();
      fireEvent.change(passwordField(), { target: { value: GOOD } });
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      act(() => {
        window.dispatchEvent(new Event('offline'));
      });
      const status = screen.getByRole('status');
      expect(status.textContent).toContain('You’re offline');
      expect(status.textContent).toContain('What you typed is still here. Continue works again when you’re back online.');
      const button = screen.getByRole('button', { name: 'Continue, available when you’re back online' });
      expect(button.getAttribute('aria-disabled')).toBe('true');
      fireEvent.submit(passwordField().closest('form')!);
      expect(api.callsTo('resetPassword')).toHaveLength(0);
      expect(passwordField().value).toBe(GOOD);

      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
      act(() => {
        window.dispatchEvent(new Event('online'));
      });
      expect(screen.queryByText('You’re offline')).toBeNull();
      expect(continueButton().getAttribute('aria-disabled')).toBeNull();
    });

    it('the server did not answer: the link is unused and still works', async () => {
      api.set({ resetPassword: { status: 500, body: fixture('error_internal_error') } });
      render();
      choose();
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('The server didn’t answer');
      await waitFor(() => expect(document.activeElement).toBe(alert));
      expect(passwordField().value).toBe(GOOD);
    });

    it('expired or used (400 TOKEN_CONSUMED): one page for both, Go to sign in', async () => {
      api.set({ resetPassword: 'error_reset_token_not_valid' });
      render();
      choose();
      const heading = await screen.findByRole('heading', { level: 1, name: 'This invite link has expired or was already used' });
      await waitFor(() => expect(document.activeElement).toBe(heading));
      expect(screen.queryByText(/authenticator/)).toBeNull();
      const signIn = screen.getByRole('link', { name: 'Go to sign in' });
      expect(signIn.getAttribute('href')).toBe('/');
      // The single next step is primary, as `STF/AcceptUsed` draws it.
      expect(signIn.getAttribute('data-variant')).toBe('primary');
    });

    it('done: the account is ready, no authenticator step promised, Go to sign in', async () => {
      render();
      choose();
      const heading = await screen.findByRole('heading', { level: 1, name: 'Your account is ready' });
      await waitFor(() => expect(document.activeElement).toBe(heading));
      expect(screen.getByText('Setting up doesn’t sign you in. Sign in with your work email and your password.')).toBeTruthy();
      expect(screen.queryByText(/authenticator/)).toBeNull();
      expect(screen.getByRole('link', { name: 'Go to sign in' }).getAttribute('href')).toBe('/');
      expect(api.callsTo('resetPassword')[0]?.body).toEqual({ token: TOKEN, new_password: GOOD });
      expect(api.callsTo('resetPassword')[0]?.body).not.toHaveProperty('totp_code');
    });
  });
});
