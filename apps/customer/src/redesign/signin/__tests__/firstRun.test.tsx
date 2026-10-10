/**
 * S3 Your details, the S4 address step and Terms and privacy (boards `SI/ProfileCapture`,
 * `SI/Profile-*`, `SI/SignedIn-address`, `-noaddress`, `-firstaddress`, `AC/Legal-terms*`).
 */
import * as React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { isAuthed, setToken } from '../../../api/token';
import { resetAuthForTests } from '../../api/auth';
import { resetPublicConfigCache } from '../../api/config';
import { resetConnectivity } from '../../lib/connectivity';
import { enterProfileCapture, getSession, resetSessionForTests } from '../../session/session';
import { mockApi, payloadOf, type MockAnswer, type MockApi } from '../../test/mockApi';
import { navSpy, renderRedesign } from '../../test/render';
import { AddressStepScreen } from '../AddressStepScreen';
import { TermsScreen } from '../TermsScreen';
import { YourDetailsScreen } from '../YourDetailsScreen';

const PROFILE = payloadOf('customer_profile');
/** A new account: a phone and nothing else (CustomerProfile, nullable names and email). */
const NEW_PROFILE: MockAnswer = {
  status: 200,
  body: { data: { ...PROFILE, first_name: '', last_name: null, email: null, default_address_id: null, marketing_consent_at: null } },
};

let mock: MockApi;

beforeEach(() => {
  resetConnectivity();
  resetPublicConfigCache();
  resetAuthForTests();
  resetSessionForTests();
  act(() => setToken('access', 'hgrt_x'));
  enterProfileCapture();
  mock = mockApi({ getCustomerProfile: NEW_PROFILE });
});

afterEach(() => {
  mock.restore();
  act(() => setToken(null));
  resetSessionForTests();
});

async function ready(): Promise<void> {
  await screen.findByTestId('Profile-first-field');
}

describe('S3 Your details', () => {
  it('loading: holds the fields while the profile is read', () => {
    mock.answer('getCustomerProfile', 'hang');
    renderRedesign(<YourDetailsScreen />);
    expect(screen.getByText('Your details')).toBeTruthy();
    expect(screen.getByTestId('Profile-loading')).toBeTruthy();
  });

  it('empty: the name step with consent off until an email is typed', async () => {
    renderRedesign(<YourDetailsScreen />);
    await ready();
    expect(screen.getByText('Tell us what to call you. Only your first name is needed to order.')).toBeTruthy();
    expect(screen.getByText('Add an email first to get news by email.')).toBeTruthy();
    expect(screen.getByTestId('Profile-consent').props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(screen.getByTestId('Profile-email-field'), 'aisha.malik@example.com');
    expect(
      screen.getByText("We'll only start once you confirm your email with the link we send. You can turn this off at any time in Account."),
    ).toBeTruthy();
    expect(screen.getByText('Save and continue')).toBeTruthy();
    expect(screen.getByText('Not you? Use a different number')).toBeTruthy();
  });

  it('renders in dark, with the validation errors', async () => {
    renderRedesign(<YourDetailsScreen />, { scheme: 'dark' });
    await ready();
    fireEvent.changeText(screen.getByTestId('Profile-email-field'), 'aisha.malik@');
    fireEvent.press(screen.getByText('Save and continue'));
    expect(screen.getByText(/Enter your first name\./)).toBeTruthy();
    expect(screen.getByText(/Enter an email like name@example\.com, or leave it blank\./)).toBeTruthy();
    expect(mock.callsTo('updateCustomerProfile')).toHaveLength(0);
  });

  it('saves names, email and consent only, then the address step when there is no default address', async () => {
    mock.answer('updateCustomerProfile', { status: 200, body: { data: { ...PROFILE, first_name: 'Aisha', default_address_id: null } } });
    renderRedesign(<YourDetailsScreen />);
    await ready();
    fireEvent.changeText(screen.getByTestId('Profile-first-field'), 'Aisha');
    fireEvent.changeText(screen.getByTestId('Profile-last-field'), 'Malik');
    fireEvent.changeText(screen.getByTestId('Profile-email-field'), 'aisha.malik@example.com');
    fireEvent.press(screen.getByText('Email me news and offers from HalalGoes'));
    fireEvent.press(screen.getByText('Save and continue'));
    await waitFor(() => expect(getSession().phase).toBe('app'));
    expect(mock.callsTo('updateCustomerProfile')[0]!.body).toEqual({
      first_name: 'Aisha',
      last_name: 'Malik',
      email: 'aisha.malik@example.com',
      marketing_consent: true,
    });
    expect(getSession().landing).toEqual({ name: 'addressStep' });
  });

  it('with a default address already: Home', async () => {
    renderRedesign(<YourDetailsScreen />);
    await ready();
    fireEvent.changeText(screen.getByTestId('Profile-first-field'), 'Aisha');
    fireEvent.press(screen.getByText('Save and continue'));
    await waitFor(() => expect(getSession().phase).toBe('app'));
    expect(getSession().landing).toEqual({ name: 'home' });
  });

  it('saving: Saving', async () => {
    mock.answer('updateCustomerProfile', 'hang');
    renderRedesign(<YourDetailsScreen />);
    await ready();
    fireEvent.changeText(screen.getByTestId('Profile-first-field'), 'Aisha');
    fireEvent.press(screen.getByText('Save and continue'));
    expect(await screen.findByText('Saving')).toBeTruthy();
  });

  it('422 on the email: names the email, keeps everything typed', async () => {
    mock.answer('updateCustomerProfile', {
      status: 422,
      code: 'VALIDATION_FAILED',
      details: [{ field: 'email', code: 'format', message: 'invalid email' }],
    });
    renderRedesign(<YourDetailsScreen />);
    await ready();
    fireEvent.changeText(screen.getByTestId('Profile-first-field'), 'Aisha');
    // Passes the loose check on the phone; the server is the judge.
    fireEvent.changeText(screen.getByTestId('Profile-email-field'), 'aisha.malik@example.invalid');
    fireEvent.press(screen.getByText('Save and continue'));
    expect(await screen.findByText(/We couldn't use this email\. Check it's typed correctly, or leave it blank\./)).toBeTruthy();
    expect(screen.getByTestId('Profile-first-field').props.value).toBe('Aisha');
  });

  it('EMAIL_IN_USE: the email-rejected field error, not the connection banner', async () => {
    mock.answer('updateCustomerProfile', { status: 422, code: 'EMAIL_IN_USE' });
    renderRedesign(<YourDetailsScreen />);
    await ready();
    fireEvent.changeText(screen.getByTestId('Profile-first-field'), 'Aisha');
    fireEvent.changeText(screen.getByTestId('Profile-email-field'), 'aisha.malik@example.com');
    fireEvent.press(screen.getByText('Save and continue'));
    expect(await screen.findByText(/We couldn't use this email\. Check it's typed correctly, or leave it blank\./)).toBeTruthy();
    expect(screen.queryByText("We couldn't save your details")).toBeNull();
  });

  it('an unchanged email is not sent again (it would clear the verified state)', async () => {
    mock.answer('getCustomerProfile', {
      status: 200,
      body: { data: { ...PROFILE, first_name: '', email: 'Aisha.Malik@example.com', default_address_id: null } },
    });
    renderRedesign(<YourDetailsScreen />);
    await ready();
    await waitFor(() => expect(screen.getByTestId('Profile-email-field').props.value).toBe('Aisha.Malik@example.com'));
    fireEvent.changeText(screen.getByTestId('Profile-first-field'), 'Aisha');
    fireEvent.changeText(screen.getByTestId('Profile-email-field'), 'aisha.malik@example.com');
    fireEvent.press(screen.getByText('Save and continue'));
    await waitFor(() => expect(mock.callsTo('updateCustomerProfile')).toHaveLength(1));
    expect(mock.callsTo('updateCustomerProfile')[0]!.body).not.toHaveProperty('email');
  });

  it('a failed Save says the first invalid field’s error out loud', async () => {
    const { AccessibilityInfo } = require('react-native');
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    renderRedesign(<YourDetailsScreen />);
    await ready();
    fireEvent.changeText(screen.getByTestId('Profile-email-field'), 'aisha.malik@');
    fireEvent.press(screen.getByText('Save and continue'));
    expect(announce).toHaveBeenCalledWith('Enter your first name.');
    announce.mockRestore();
  });

  it('save failed: We couldn’t save your details', async () => {
    mock.answer('updateCustomerProfile', 'error_internal_error');
    renderRedesign(<YourDetailsScreen />);
    await ready();
    fireEvent.changeText(screen.getByTestId('Profile-first-field'), 'Aisha');
    fireEvent.press(screen.getByText('Save and continue'));
    expect(await screen.findByText("We couldn't save your details")).toBeTruthy();
    expect(screen.getByText('What you typed is still here. Check your connection and try again.')).toBeTruthy();
    expect(getSession().phase).toBe('profile');
  });

  it('offline: says so and Save waits for the connection, with the reason', async () => {
    mock.answer('getCustomerProfile', 'offline');
    renderRedesign(<YourDetailsScreen />);
    await ready();
    expect(screen.getByText("You're offline")).toBeTruthy();
    expect(screen.getByText('What you type stays here. Connect to Wi-Fi or mobile data to save it.')).toBeTruthy();
    expect(screen.getByText('Connect to the internet to save.')).toBeTruthy();
    expect(screen.getByTestId('Profile-save').props.accessibilityState?.disabled).toBe(true);
  });

  it('from the cart: Back to cart, and Save and go to checkout replaces this page with Checkout', async () => {
    const nav = navSpy({ name: 'yourDetails', fromCart: true });
    renderRedesign(<YourDetailsScreen fromCart />, { nav });
    await ready();
    expect(screen.getByText('Add your name to order')).toBeTruthy();
    expect(screen.getByText("Your cart is saved. We'll take you back to it when you're done.")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('Profile-first-field'), 'Aisha');
    fireEvent.press(screen.getByText('Save and go to checkout'));
    await waitFor(() => expect(nav.log).toContainEqual({ action: 'replace', route: { name: 'checkout' } }));
    fireEvent.press(screen.getByLabelText('Back to cart'));
    expect(nav.log).toContainEqual({ action: 'back' });
  });

  it('"Not you?" signs this phone out with the Not you note', async () => {
    renderRedesign(<YourDetailsScreen />);
    await ready();
    act(() => {
      fireEvent.press(screen.getByText('Not you? Use a different number'));
    });
    expect(isAuthed()).toBe(false);
    expect(getSession()).toMatchObject({ phase: 'signin', signedOut: 'notYou' });
  });
});

describe('S4 address step', () => {
  it('no address yet: Where should we deliver?, Add your address opens the first-address form', async () => {
    mock.answer('listAddresses', 'addresses_empty');
    const nav = navSpy({ name: 'addressStep' });
    renderRedesign(<AddressStepScreen />, { nav });
    expect(screen.getByText('Where should we deliver?')).toBeTruthy();
    expect(screen.getByText("Search for your address, then drag the pin onto your door. You don't need to be there.")).toBeTruthy();
    expect(screen.getByText("You can look at restaurants now. You'll need an address before adding food to your cart.")).toBeTruthy();
    await waitFor(() => expect(mock.callsTo('listAddresses').length).toBe(1));
    fireEvent.press(screen.getByText('Add your address'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'addressForm', addressId: null, first: true } });
  });

  it('Not now lands on Home', () => {
    mock.answer('listAddresses', 'addresses_empty');
    const nav = navSpy({ name: 'addressStep' });
    renderRedesign(<AddressStepScreen />, { nav, scheme: 'dark' });
    fireEvent.press(screen.getByText('Not now'));
    expect(nav.log).toContainEqual({ action: 'reset', route: { name: 'home' } });
  });

  it('back from the form with an address: Home with "Address saved"', async () => {
    mock.answer('listAddresses', 'addresses_list');
    const nav = navSpy({ name: 'addressStep' });
    renderRedesign(<AddressStepScreen />, { nav });
    await waitFor(() => expect(nav.log).toContainEqual({ action: 'reset', route: { name: 'home' } }));
    const list = payloadOf('addresses_list') as Array<{ line1: string; is_default: boolean }>;
    const saved = list.find((a) => a.is_default) ?? list[0]!;
    expect(getSession().welcome).toEqual({
      variant: 'success',
      title: 'Address saved',
      description: `Showing restaurants that deliver to ${saved.line1}.`,
    });
  });

  it('a failed address read keeps the step', async () => {
    mock.answer('listAddresses', 'error_internal_error');
    const nav = navSpy({ name: 'addressStep' });
    renderRedesign(<AddressStepScreen />, { nav });
    await waitFor(() => expect(mock.callsTo('listAddresses').length).toBe(1));
    expect(screen.getByText('Where should we deliver?')).toBeTruthy();
    expect(nav.log).toHaveLength(0);
  });
});

describe('Terms and privacy', () => {
  it('loading, then the version from PublicConfig', async () => {
    renderRedesign(<TermsScreen signedOut />, { nav: navSpy({ name: 'terms', signedOut: true }) });
    expect(screen.getByTestId('Terms-loading')).toBeTruthy();
    expect(await screen.findByText(`Version ${payloadOf('public_config').terms_version}`)).toBeTruthy();
    expect(screen.getByText('How we use and protect your information')).toBeTruthy();
    expect(screen.getByLabelText('Back to sign in')).toBeTruthy();
  });

  it('error: no guessed version, Try again', async () => {
    mock.answer('getPublicConfig', 'error_internal_error');
    renderRedesign(<TermsScreen />, { nav: navSpy({ name: 'terms' }), scheme: 'dark' });
    expect(await screen.findByText("We couldn't load the terms")).toBeTruthy();
    expect(screen.queryByText(/^Version /)).toBeNull();
    expect(screen.getByLabelText('Back to Account')).toBeTruthy();
  });
});
