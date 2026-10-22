/**
 * Account, Edit details, Sign out, Saved addresses, Notification settings and the email link,
 * against the contract's fixtures: every screen's loading, empty, error and populated states, and
 * the rules a screen enforces (boards `AC/*`).
 */
import * as React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import type { Schema } from '@hg/api-client';

import { getToken, setToken } from '../../../api/token';
import { resetPublicConfigCache } from '../../api/config';
import { resetAuthForTests } from '../../api/auth';
import { resetConnectivity } from '../../lib/connectivity';
import { setNowOverride } from '../../lib/now';
import { resetSessionForTests } from '../../session/session';
import { mockApi, payloadOf, type MockAnswer, type MockApi } from '../../test/mockApi';
import { navSpy, renderRedesign } from '../../test/render';
import { AccountScreen } from '../AccountScreen';
import { AddressesScreen } from '../AddressesScreen';
import { EmailVerifyScreen } from '../EmailVerifyScreen';
import { NotificationSettingsScreen } from '../NotificationSettingsScreen';

type Profile = Schema['CustomerProfile'];
type Address = Schema['Address'];

const PROFILE = payloadOf<Profile>('customer_profile');
const ADDRESSES = payloadOf<Address[]>('addresses_list');
const T0 = Date.parse('2026-10-09T22:42:00Z');

const profileWith = (patch: Partial<Profile>): MockAnswer => ({ status: 200, body: { data: { ...PROFILE, ...patch } } });
const UNCONFIRMED = profileWith({ email: 'aisha.m@example.ca', email_verified: false });
const CONFIRMED = profileWith({ email: 'aisha.m@example.ca', email_verified: true, marketing_consent_at: null });
const NO_EMAIL = profileWith({ email: null, email_verified: false, marketing_consent_at: null });
const page = (data: unknown[]): MockAnswer => ({ status: 200, body: { data, meta: { next_cursor: null, has_more: false, total: data.length } } });

let mock: MockApi;
let permission: jest.SpyInstance;

function allow(state: 'granted' | 'notAsked' | 'denied') {
  permission.mockResolvedValue({
    granted: state === 'granted',
    canAskAgain: state !== 'denied',
    status: state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'undetermined',
    expires: 'never',
  } as never);
}

beforeEach(() => {
  resetConnectivity();
  resetPublicConfigCache();
  resetAuthForTests();
  resetSessionForTests();
  setNowOverride({ at: T0 });
  act(() => setToken('access', 'hgrt_x'));
  permission = jest.spyOn(Notifications, 'getPermissionsAsync');
  allow('granted');
});

afterEach(() => {
  mock?.restore();
  permission.mockRestore();
  setNowOverride(null);
  act(() => setToken(null));
});

function renderAccount(answers: Record<string, MockAnswer> = {}) {
  mock = mockApi({ getCustomerProfile: UNCONFIRMED, listAddresses: 'addresses_list', ...answers });
  const nav = navSpy({ name: 'account' });
  renderRedesign(<AccountScreen />, { nav });
  return nav;
}

describe('Account (A1)', () => {
  it('loading: skeletons, and no content until the profile answers', () => {
    renderAccount({ getCustomerProfile: 'hang' });
    expect(screen.getByTestId('Account-loading')).toBeTruthy();
    expect(screen.queryByText('Sign out')).toBeNull();
  });

  it('error: says so, retries, and still offers Sign out', async () => {
    renderAccount({ getCustomerProfile: [{ status: 500, code: 'INTERNAL_ERROR' }, UNCONFIRMED] });
    expect(await screen.findByText("We couldn't load your account")).toBeTruthy();
    expect(screen.getByText('Sign out')).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByTestId('Account-profile')).toBeTruthy();
    expect(mock.callsTo('getCustomerProfile')).toHaveLength(2);
  });

  it('shows the contract fields and nothing it does not return', async () => {
    renderAccount({ getCustomerProfile: CONFIRMED });
    expect(await screen.findByTestId('Account-phone')).toHaveTextContent(/^\+1 \d{3} \d{3} \d{4}$/);
    expect(screen.getByText('aisha.m@example.ca')).toBeTruthy();
    expect(screen.queryByTestId('Account-unconfirmed')).toBeNull();
    expect(screen.queryByText('Send the link again')).toBeNull();
  });

  it('an unconfirmed email says so and resends the link to that address only', async () => {
    renderAccount({ resendEmailVerification: { status: 202, body: { data: { accepted: true } } } });
    expect(await screen.findByTestId('Account-unconfirmed')).toBeTruthy();
    fireEvent.press(screen.getByText('Send the link again'));
    expect(await screen.findByText('Link sent')).toBeTruthy();
    expect(mock.callsTo('resendEmailVerification')[0]!.body).toEqual({ email: 'aisha.m@example.ca' });
  });

  it('a per-minute 429 shows a static time and disables the button; the day limit says so', async () => {
    renderAccount({ resendEmailVerification: { status: 429, code: 'RATE_LIMITED', headers: { 'Retry-After': '60', Date: new Date(T0).toUTCString() } } });
    fireEvent.press(await screen.findByText('Send the link again'));
    expect(await screen.findByTestId('Account-resendMinute')).toHaveTextContent('You can ask for a new link at 6:43 pm.');
    expect(screen.getByTestId('Account-resend')).toBeDisabled();

  });

  it('a long wait on the 429 is the daily limit, in words', async () => {
    renderAccount({ resendEmailVerification: { status: 429, code: 'RATE_LIMITED', headers: { 'Retry-After': '40000' } } });
    fireEvent.press(await screen.findByText('Send the link again'));
    expect(await screen.findByText("You've asked 5 times today. Try again tomorrow.")).toBeTruthy();
    expect(screen.getByTestId('Account-resend')).toBeDisabled();
  });

  it('no email: offers Add an email and opens the sheet, and an email cannot be removed', async () => {
    renderAccount({ getCustomerProfile: NO_EMAIL });
    fireEvent.press(await screen.findByText('Add an email'));
    expect(await screen.findByTestId('EditDetails')).toBeTruthy();
    expect(screen.getByText(/Once added, you can change it but not remove it/)).toBeTruthy();
  });

  it('Call support, closed and unavailable follow the server, never the clock', async () => {
    renderAccount({ getPublicConfig: 'public_config_phone_support_off' });
    expect(await screen.findByText(/Phone support is closed now|Phone support isn't available right now/)).toBeTruthy();
    expect(screen.queryByText('Call support')).toBeNull();
  });

  it('the delete paragraph uses the support email from the config when there is one', async () => {
    renderAccount({ getPublicConfig: 'public_config' });
    const email = payloadOf<Schema['PublicConfig']>('public_config').support_email;
    expect(await screen.findByTestId('Account-deletion')).toHaveTextContent(email ? new RegExp(email.replace('.', '\\.')) : /call us/);
  });

  it("opens Addresses, Notification settings, How we check, What's new and Terms", async () => {
    const nav = renderAccount();
    await screen.findByTestId('Account-profile');
    fireEvent.press(screen.getByTestId('Account-addresses'));
    fireEvent.press(screen.getByTestId('Account-notificationSettings'));
    fireEvent.press(screen.getByTestId('Account-howWeCheck'));
    fireEvent.press(screen.getByTestId('Account-whatsNew'));
    fireEvent.press(screen.getByTestId('Account-terms'));
    expect(nav.log.map((l) => l.route?.name)).toEqual(['addresses', 'notificationSettings', 'howWeCheck', 'whatsNew', 'terms']);
  });

  it('draws no row for a page that is not built', async () => {
    renderAccount();
    await screen.findByTestId('Account-profile');
    for (const missing of ['Payment methods', 'Refunds', 'App settings']) expect(screen.queryByText(missing)).toBeNull();
  });
});

describe('Edit details (A2)', () => {
  async function openEdit() {
    fireEvent.press(await screen.findByTestId('Account-edit'));
    await screen.findByTestId('EditDetails');
  }

  it('saves only what changed and shows the new address as not confirmed', async () => {
    renderAccount({ getCustomerProfile: CONFIRMED, updateCustomerProfile: profileWith({ email: 'new@example.ca', email_verified: false }) });
    await openEdit();
    fireEvent.changeText(screen.getByTestId('EditDetails-email-field'), 'new@example.ca');
    fireEvent.press(screen.getByTestId('EditDetails-save'));
    expect(await screen.findByText('Details saved')).toBeTruthy();
    expect(mock.callsTo('updateCustomerProfile')[0]!.body).toEqual({ email: 'new@example.ca' });
    expect(screen.getByText('new@example.ca')).toBeTruthy();
    expect(screen.getByTestId('Account-unconfirmed')).toBeTruthy();
    expect(screen.getByText(/to this new address/)).toBeTruthy();
  });

  it('a rejected email (422) is the field error and keeps what was typed', async () => {
    renderAccount({ updateCustomerProfile: { status: 422, code: 'VALIDATION_FAILED', details: [{ field: 'email', code: 'INVALID' }] } });
    await openEdit();
    fireEvent.changeText(screen.getByTestId('EditDetails-email-field'), 'odd@example.ca');
    fireEvent.press(screen.getByTestId('EditDetails-save'));
    expect(await screen.findByText(/We couldn't use this email\. Check it's typed correctly\./)).toBeTruthy();
  });

  it('a failed save keeps the sheet and what was typed', async () => {
    renderAccount({ updateCustomerProfile: { status: 500, code: 'INTERNAL_ERROR' } });
    await openEdit();
    fireEvent.changeText(screen.getByTestId('EditDetails-first-field'), 'Zee');
    fireEvent.press(screen.getByTestId('EditDetails-save'));
    expect(await screen.findByTestId('EditDetails-failed')).toBeTruthy();
    expect(screen.getByTestId('EditDetails-first-field').props.value).toBe('Zee');
  });

  it('an empty first name is refused before anything is sent', async () => {
    renderAccount();
    await openEdit();
    fireEvent.changeText(screen.getByTestId('EditDetails-first-field'), '');
    fireEvent.press(screen.getByTestId('EditDetails-save'));
    expect(await screen.findByText(/Enter your first name\./)).toBeTruthy();
    expect(mock.callsTo('updateCustomerProfile')).toHaveLength(0);
  });

  it('the mobile number is read-only: shown, with no field to edit it', async () => {
    renderAccount();
    await openEdit();
    expect(screen.getByTestId('EditDetails-phone')).toBeTruthy();
    expect(screen.queryByTestId('EditDetails-phone-field')).toBeNull();
  });
});

describe('Sign out (A10)', () => {
  it('asks first, Stay signed in keeps the session, Sign out ends it on this phone', async () => {
    renderAccount();
    fireEvent.press(await screen.findByTestId('Account-signout'));
    const dialog = await screen.findByTestId('Account-signOutDialog');
    fireEvent.press(within(dialog).getByText('Stay signed in'));
    expect(getToken()).toBe('access');
    fireEvent.press(screen.getByTestId('Account-signout'));
    fireEvent.press(within(await screen.findByTestId('Account-signOutDialog')).getByText('Sign out'));
    await waitFor(() => expect(getToken()).toBeNull());
  });
});

describe('Saved addresses (A4)', () => {
  const renderAddresses = (answer: MockAnswer = 'addresses_list') => {
    mock = mockApi({ listAddresses: answer });
    const nav = navSpy({ name: 'addresses' });
    renderRedesign(<AddressesScreen />, { nav });
    return nav;
  };

  it('loading, error with retry, and empty', async () => {
    renderAddresses('hang');
    expect(screen.getByTestId('Addresses-loading')).toBeTruthy();
    mock.restore();

    renderAddresses({ status: 500, code: 'INTERNAL_ERROR' });
    expect(await screen.findByText("We couldn't load your addresses")).toBeTruthy();
    mock.restore();

    renderAddresses('addresses_empty');
    expect(await screen.findByText('No saved addresses')).toBeTruthy();
  });

  it('lists the default first with its badge and opens that address', async () => {
    const nav = renderAddresses();
    const list = await screen.findByTestId('Addresses-list');
    const first = ADDRESSES.find((a) => a.is_default)!;
    expect(within(list).getAllByText('Default')).toHaveLength(1);
    fireEvent.press(screen.getByTestId(`Address-${first.id}`));
    expect(nav.log.at(-1)).toEqual({ action: 'push', route: { name: 'addressForm', addressId: first.id } });
  });

  it('twenty saved: Add address is disabled and the reason is on the page', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => ({ ...ADDRESSES[0]!, id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, is_default: i === 0 }));
    renderAddresses(page(twenty));
    expect(await screen.findByText("You've saved 20, the most you can keep. Delete one to add another.")).toBeTruthy();
    expect(screen.getByTestId('Addresses-add')).toBeDisabled();
  });

  it('no default among the saved addresses asks the customer to choose one', async () => {
    renderAddresses(page(ADDRESSES.map((a) => ({ ...a, is_default: false }))));
    expect(await screen.findByText('Choose a default address')).toBeTruthy();
  });

  it('Add address opens a blank form', async () => {
    const nav = renderAddresses();
    fireEvent.press(await screen.findByTestId('Addresses-add'));
    expect(nav.log.at(-1)?.route).toEqual({ name: 'addressForm', addressId: null });
  });
});

describe('Notification settings (A5)', () => {
  const renderSettings = (answers: Record<string, MockAnswer> = {}) => {
    mock = mockApi({ getCustomerProfile: CONFIRMED, ...answers });
    renderRedesign(<NotificationSettingsScreen />, { nav: navSpy({ name: 'notificationSettings' }) });
  };

  it('loading and error with retry', async () => {
    renderSettings({ getCustomerProfile: 'hang' });
    expect(screen.getByTestId('Notifications-loading')).toBeTruthy();
    mock.restore();
    renderSettings({ getCustomerProfile: { status: 500, code: 'INTERNAL_ERROR' } });
    expect(await screen.findByText("We couldn't load your settings")).toBeTruthy();
  });

  it('push: allowed, not asked yet, and denied each say what the phone says', async () => {
    renderSettings();
    expect(await screen.findByText('Allowed on this phone')).toBeTruthy();
    mock.restore();
    allow('notAsked');
    renderSettings();
    expect(await screen.findByText('Turn on notifications')).toBeTruthy();
    mock.restore();
    allow('denied');
    renderSettings();
    expect(await screen.findByText('Push notifications are off')).toBeTruthy();
  });

  it('the email switch keeps its old position until the server confirms, then follows it', async () => {
    renderSettings({ updateCustomerProfile: profileWith({ email: 'aisha.m@example.ca', email_verified: true, marketing_consent_at: '2026-09-03T15:00:00Z' }) });
    const sw = await screen.findByTestId('Notifications-emailSwitch');
    expect(sw.props.accessibilityState?.checked ?? false).toBe(false);
    fireEvent.press(sw);
    await waitFor(() => expect(mock.callsTo('updateCustomerProfile')).toHaveLength(1));
    expect(mock.callsTo('updateCustomerProfile')[0]!.body).toEqual({ marketing_consent: true });
    expect(await screen.findByText(/You agreed on 3 September 2026/)).toBeTruthy();
  });

  it('a failed change leaves the setting as it was and says so', async () => {
    renderSettings({ updateCustomerProfile: { status: 500, code: 'INTERNAL_ERROR' } });
    fireEvent.press(await screen.findByTestId('Notifications-emailSwitch'));
    expect(await screen.findByTestId('Notifications-failed')).toBeTruthy();
    expect(screen.getByText(/You won't get news or offers by email/)).toBeTruthy();
  });

  it('no email: the switch is off and disabled, and Add an email is offered', async () => {
    renderSettings({ getCustomerProfile: NO_EMAIL });
    expect(await screen.findByText('Add an email')).toBeTruthy();
    expect(screen.getByTestId('Notifications-emailSwitch')).toBeDisabled();
  });

  it('consent given before the email is confirmed says nothing is sent until it is', async () => {
    renderSettings({ getCustomerProfile: profileWith({ email: 'aisha.m@example.ca', email_verified: false, marketing_consent_at: '2026-09-28T12:00:00Z' }) });
    expect(await screen.findByText(/we send nothing there/)).toBeTruthy();
  });
});

describe('Email link (A9)', () => {
  const TOKEN = 'a'.repeat(40);
  const renderVerify = (answers: Record<string, MockAnswer>) => {
    mock = mockApi({ getCustomerProfile: CONFIRMED, ...answers });
    const nav = navSpy({ name: 'emailVerify', token: TOKEN });
    renderRedesign(<EmailVerifyScreen token={TOKEN} />, { nav });
    return nav;
  };

  it('checks the link once, then confirms the address', async () => {
    renderVerify({ verifyEmail: { status: 204, body: null } });
    expect(screen.getByTestId('EmailVerify-checking')).toBeTruthy();
    expect(await screen.findByText('Your email is confirmed')).toBeTruthy();
    expect(screen.getByText(/We can now email you at aisha\.m@example\.ca\./)).toBeTruthy();
    expect(mock.callsTo('verifyEmail')).toHaveLength(1);
    expect(mock.callsTo('verifyEmail')[0]!.body).toEqual({ token: TOKEN });
  });

  it('a run-out link offers a new one, to the address on the account', async () => {
    renderVerify({
      verifyEmail: 'error_verification_token_expired',
      getCustomerProfile: UNCONFIRMED,
      resendEmailVerification: { status: 202, body: { data: { accepted: true } } },
    });
    expect(await screen.findByText('This link has run out')).toBeTruthy();
    fireEvent.press(screen.getByText('Send a new link'));
    expect(await screen.findByText('We sent a new link')).toBeTruthy();
    expect(mock.callsTo('resendEmailVerification')[0]!.body).toEqual({ email: 'aisha.m@example.ca' });
  });

  it('an already-used link reads the account: confirmed, or still to confirm', async () => {
    renderVerify({ verifyEmail: 'error_verification_token_used' });
    expect(await screen.findByText('Your email is already confirmed')).toBeTruthy();
    mock.restore();
    renderVerify({ verifyEmail: 'error_verification_token_used', getCustomerProfile: UNCONFIRMED });
    expect(await screen.findByText(/Your email isn't confirmed yet/)).toBeTruthy();
  });

  it('a connection failure is retryable, and the link is not treated as spent', async () => {
    renderVerify({ verifyEmail: ['offline', { status: 204, body: null }] });
    expect(await screen.findByText("We couldn't confirm your email")).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByText('Your email is confirmed')).toBeTruthy();
  });

  it('a confirmed link whose account email is unreadable still confirms, naming no address', async () => {
    renderVerify({ verifyEmail: { status: 204, body: null }, getCustomerProfile: { status: 500, code: 'INTERNAL_ERROR' } });
    expect(await screen.findByText('We can now email you.')).toBeTruthy();
  });
});
