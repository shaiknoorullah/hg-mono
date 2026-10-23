/**
 * The setup top bar's account menu (canvas ON `OnbTop`): the menu's text is the signed-in account's
 * email. The app has no read that returns it, so it shows the address that signed in on this device
 * (the one the sign-in screen already remembers) and nothing is stored for it here.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SetupTopBar } from './OnboardingFrame';
import { rememberEmail } from '../auth/api';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('setup top bar account menu', () => {
  it('shows the email that signed in on this device as the menu text, named for it', () => {
    rememberEmail('samir@zaytoungrill.ca');
    render(<SetupTopBar businessName="Zaytoun Grill" onSignOut={() => undefined} />);
    expect(screen.getByTestId('account-email').textContent).toBe('samir@zaytoungrill.ca');
    expect(screen.getByRole('button', { name: 'Account menu, samir@zaytoungrill.ca' })).toBeTruthy();
    expect(screen.getByTestId('business-name').textContent).toBe('Zaytoun Grill');
  });

  it('falls back to the icon alone when this device has no remembered address, and invents none', () => {
    render(<SetupTopBar businessName="Zaytoun Grill" onSignOut={() => undefined} />);
    expect(screen.queryByTestId('account-email')).toBeNull();
    expect(screen.getByRole('button', { name: 'Account: Zaytoun Grill' })).toBeTruthy();
  });

  it('writes nothing to storage while showing it', () => {
    rememberEmail('samir@zaytoungrill.ca');
    const before = JSON.stringify({ ...localStorage });
    render(<SetupTopBar businessName="Zaytoun Grill" onSignOut={() => undefined} />);
    expect(JSON.stringify({ ...localStorage })).toBe(before);
  });
});
