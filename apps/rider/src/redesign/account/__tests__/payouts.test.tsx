/**
 * WP9 Payouts with Stripe (R14 application step 5, R47 Account › Payouts) against the fixtures,
 * light and dark. Pins the WP9 DONE list: 404 from getConnectStatus is "not started", never an
 * error; the Stripe link opens in the browser and the status is read again on return ("Check
 * again"); createConnectAccount's Idempotency-Key is reused on retry; raw Stripe requirement
 * keys never show; nothing sent carries a price.
 */
import * as React from 'react';
import { AppState, Linking, Text } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => {
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('../../../push', () => ({ registerForPush: jest.fn(), unregisterForPush: jest.fn(), takeRegisteredDeviceId: jest.fn(() => null) }));

import * as Clipboard from 'expo-clipboard';
import { reportTransportFailure, resetConnectivity } from '../../data/connectivity';
import { useNav } from '../../nav/Navigator';
import { registerScreen } from '../../nav/registry';
import { Shell } from '../../nav/Shell';
import { mockApi, type MockApi } from '../../test/mockApi';
import { renderRedesign, SCHEMES } from '../../test/render';
import { longDate } from '../copy';
import { SLOW_CHECK_MS } from '../PayoutsScreen';
import '../index';
import { apiError, config, connectOn, connectWith, supportOff } from './fixtures';

const LINK = { status: 201, body: { data: { url: 'https://connect.stripe.com/setup/e/acct_1/abc', expires_at: '2026-10-09T22:00:00.000Z' } } };
const PRICE_KEYS = /price|_cents|amount|total/i;
const RAW_KEYS = ['individual.verification.document', 'external_account', 'individual.id_number'];

function HomeProbe() {
  const nav = useNav();
  return <Text testID="home-probe">{`home tab=${nav.tab} flow=${nav.flow ? nav.flow[0]!.name : 'none'}`}</Text>;
}

let api: MockApi;
let openURL: jest.SpyInstance;
let appStateListeners: ((s: string) => void)[];
let appStateSpy: jest.SpyInstance;

beforeEach(() => {
  registerScreen('home', { component: HomeProbe });
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  appStateListeners = [];
  appStateSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((type: string, fn: (s: string) => void) => {
    if (type === 'change') appStateListeners.push(fn);
    return { remove: () => void (appStateListeners = appStateListeners.filter((f) => f !== fn)) };
  }) as never);
  (Clipboard.setStringAsync as jest.Mock).mockClear();
});

afterEach(() => {
  api?.restore();
  openURL.mockRestore();
  appStateSpy.mockRestore();
  resetConnectivity();
  jest.useRealTimers();
});

function renderPayouts(scheme: 'light' | 'dark', context: 'application' | 'account') {
  return renderRedesign(<Shell />, { scheme, nav: { initialFlow: { name: 'payouts', params: { context } } } });
}

function returnToApp() {
  act(() => {
    for (const fn of appStateListeners) fn('active');
  });
}

describe.each(SCHEMES)('Payouts with Stripe (%s)', (scheme) => {
  it('404 is "not started", never an error; Continue creates the account, mints a link and opens Stripe (PA/Payout-Start)', async () => {
    api = mockApi({ getConnectStatus: 'error_not_found', createConnectAccount: 'connect_status_complete', createConnectOnboardingLink: LINK, getPublicConfig: config() });
    renderPayouts(scheme, 'application');
    expect(screen.getByLabelText('Loading your payout status')).toBeTruthy();
    await screen.findByText('Get paid');
    expect(screen.getByText('Step 5 of 5: payouts')).toBeTruthy();
    expect(screen.getByText('Your documents are approved.')).toBeTruthy();
    expect(screen.getByText('Stripe pays you. Stripe asks for your bank details and ID. HalalGoes only sees the last 4 digits of your account.')).toBeTruthy();
    expect(screen.queryByText("We couldn't check your payouts")).toBeNull();
    fireEvent.press(screen.getByText('Continue to Stripe'));
    await waitFor(() => expect(openURL).toHaveBeenCalledWith('https://connect.stripe.com/setup/e/acct_1/abc'));
    const create = api.callsTo('createConnectAccount');
    expect(create).toHaveLength(1);
    expect(create[0]!.headers['idempotency-key']).toMatch(/^[0-9a-f-]{16,}$/);
    expect(api.callsTo('createConnectOnboardingLink')).toHaveLength(1);
  });

  it('create fails, Try again reuses the same Idempotency-Key (PA/Payout-CreateFailed)', async () => {
    api = mockApi({
      getConnectStatus: 'error_not_found',
      createConnectAccount: (_c, nth) => (nth === 0 ? 'offline' : 'connect_status_complete'),
      createConnectOnboardingLink: LINK,
      getPublicConfig: config(),
    });
    renderPayouts(scheme, 'application');
    fireEvent.press(await screen.findByText('Continue to Stripe'));
    await screen.findByText("We couldn't set up your payout account");
    expect(screen.getByText('Nothing was created twice. Check your connection and try again.')).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => expect(openURL).toHaveBeenCalled());
    const [first, second] = api.callsTo('createConnectAccount');
    expect(second!.headers['idempotency-key']).toBe(first!.headers['idempotency-key']);
  });

  it('409 STEP_NOT_AVAILABLE: payouts open after approval (PA/Payout-NotYet)', async () => {
    api = mockApi({ getConnectStatus: 'error_not_found', createConnectAccount: apiError(409, 'STEP_NOT_AVAILABLE'), getPublicConfig: config() });
    renderPayouts(scheme, 'application');
    fireEvent.press(await screen.findByText('Continue to Stripe'));
    await screen.findByText('Payouts open after approval');
    expect(screen.getByText('Step 4 of 5: we check your documents')).toBeTruthy();
    expect(screen.getByText('Back to review')).toBeTruthy();
    expect(api.callsTo('createConnectOnboardingLink')).toHaveLength(0);
  });

  it('the link fails: Stripe didn\'t open (PA/Payout-LinkFailed)', async () => {
    api = mockApi({ getConnectStatus: 'error_not_found', createConnectAccount: 'connect_status_complete', createConnectOnboardingLink: 'error_internal_error', getPublicConfig: config() });
    renderPayouts(scheme, 'application');
    fireEvent.press(await screen.findByText('Continue to Stripe'));
    await screen.findByText("Stripe didn't open");
    expect(screen.getByText('Check your connection and try again. Each try opens a fresh, secure link.')).toBeTruthy();
    expect(openURL).not.toHaveBeenCalled();
  });

  it('back from Stripe the status is read again; a status still catching up reads "Checking with Stripe" (PA/Payout-Checking)', async () => {
    const unfinished = connectWith({}, { details_submitted: false, payouts_enabled: false });
    api = mockApi({ getConnectStatus: unfinished, createConnectOnboardingLink: LINK, getPublicConfig: config() });
    renderPayouts(scheme, 'application');
    await screen.findByText("Stripe isn't finished yet");
    expect(screen.getByText('You left Stripe before the end. Nothing is lost. Carry on where you stopped; it opens a fresh, secure link.')).toBeTruthy();
    fireEvent.press(screen.getByText('Continue with Stripe'));
    await waitFor(() => expect(openURL).toHaveBeenCalled());
    expect(api.callsTo('createConnectAccount')).toHaveLength(0); // the account exists: link only
    const before = api.callsTo('getConnectStatus').length;
    returnToApp();
    await screen.findByText('Checking with Stripe');
    expect(api.callsTo('getConnectStatus').length).toBeGreaterThan(before);
    expect(screen.getByText('This can take a minute. This screen updates by itself while the app is open.')).toBeTruthy();
  });

  it('checking, Check again re-reads, and after two minutes "still checking" (PA/Payout-Checking, -CheckingSlow)', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-09T18:00:00Z') });
    api = mockApi({ getConnectStatus: 'connect_status_requirements_due', getPublicConfig: config() });
    renderPayouts(scheme, 'application');
    await screen.findByText('Checking with Stripe');
    const before = api.callsTo('getConnectStatus').length;
    fireEvent.press(screen.getByText('Check again'));
    await waitFor(() => expect(api.callsTo('getConnectStatus').length).toBe(before + 1));
    await act(async () => {
      jest.advanceTimersByTime(SLOW_CHECK_MS + 5_000);
    });
    await screen.findByText('Stripe is still checking your details');
    expect(screen.getByText("We'll let you know when Stripe finishes.")).toBeTruthy();
  });

  it('Stripe needs things: count, later, never the raw keys; Copy details puts them on the clipboard (PA/Payout-Due)', async () => {
    api = mockApi({
      getConnectStatus: connectWith({ currently_due: ['individual.verification.document', 'external_account'], eventually_due: ['individual.id_number'] }),
      getPublicConfig: config(),
    });
    renderPayouts(scheme, 'application');
    await screen.findByText('Stripe needs 2 more things from you');
    expect(screen.getByText('Stripe will show you exactly what to add. It takes about 5 minutes.')).toBeTruthy();
    expect(screen.getByText("Stripe may ask for 1 more thing later. We'll tell you when.")).toBeTruthy();
    for (const key of RAW_KEYS) expect(screen.queryByText(key, { exact: false })).toBeNull();
    fireEvent.press(screen.getByText('Copy details for support'));
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalled());
    const copied = (Clipboard.setStringAsync as jest.Mock).mock.calls[0][0] as string;
    for (const key of RAW_KEYS) expect(copied).toContain(key);
    expect(screen.getByText('Continue to Stripe')).toBeTruthy();
  });

  it('pending verification adds the on-hold line (PA/Payout-Due-Details)', async () => {
    api = mockApi({
      getConnectStatus: connectWith({ currently_due: ['external_account'], disabled_reason: 'requirements.pending_verification' }),
      getPublicConfig: config(),
    });
    renderPayouts(scheme, 'application');
    await screen.findByText('Stripe needs 1 more thing from you');
    expect(screen.getByText('Payouts are on hold while Stripe checks what you sent.')).toBeTruthy();
  });

  it('past due: the deadline has passed (PA/Payout-PastDue)', async () => {
    const deadline = '2026-09-25T16:00:00.000Z';
    api = mockApi({ getConnectStatus: connectWith({ past_due: ['individual.verification.document'], deadline }), getPublicConfig: config() });
    renderPayouts(scheme, 'application');
    await screen.findByText('Stripe needs 1 thing from you now');
    expect(screen.getByText(`Stripe needed this by ${longDate(deadline)}. Until you add it, Stripe can't pay you.`)).toBeTruthy();
    expect(screen.getByText('Stripe deadline')).toBeTruthy();
    expect(screen.getByText(`${longDate(deadline)} (passed)`)).toBeTruthy();
  });

  it('rejected: Call support, details for support (PA/Payout-Rejected)', async () => {
    api = mockApi({ getConnectStatus: connectWith({ disabled_reason: 'rejected.other' }, { payouts_enabled: false }), getPublicConfig: config() });
    renderPayouts(scheme, 'application');
    await screen.findByText("Stripe can't pay out to this account");
    expect(screen.getByText('Stripe closed this payout account. Call support to talk about what happens next.')).toBeTruthy();
    expect(screen.getByText('Stripe declined this payout account')).toBeTruthy();
    fireEvent.press(screen.getByText('Call support'));
    expect(openURL).toHaveBeenCalledWith('tel:+18005550199');
    expect(screen.queryByText('Continue to Stripe')).toBeNull();
  });

  it('ready: Go to Home closes the application and lands on Home (PA/Payout-Ready)', async () => {
    api = mockApi({ getConnectStatus: connectOn(), getPublicConfig: config() });
    renderPayouts(scheme, 'application');
    await screen.findByText("You're ready to ride");
    expect(screen.getByText('Payouts go to your bank account ending 4821, every Monday.')).toBeTruthy();
    expect(screen.getByText('Go online from Home when you want to start.')).toBeTruthy();
    fireEvent.press(screen.getByText('Go to Home'));
    await waitFor(() => expect(screen.getByTestId('home-probe').props.children).toBe('home tab=home flow=none'));
  });

  it('status error with Try again, and support off (PA/Payout-StatusError)', async () => {
    api = mockApi({ getConnectStatus: (_c, nth) => (nth === 0 ? 'error_internal_error' : 'error_not_found'), getPublicConfig: supportOff() });
    renderPayouts(scheme, 'application');
    await screen.findByText("We couldn't check your payouts");
    expect(screen.getByText('Try again in a moment.')).toBeTruthy();
    await screen.findByText("Support isn't available right now. Try again later.");
    fireEvent.press(screen.getByText('Try again'));
    await screen.findByText('Get paid');
  });

  it('offline: Stripe needs a connection (PA/Payout-Offline)', async () => {
    api = mockApi({ getConnectStatus: 'error_not_found', getPublicConfig: config() });
    renderPayouts(scheme, 'application');
    await screen.findByText('Get paid');
    act(() => reportTransportFailure());
    expect(screen.getByText('You are offline')).toBeTruthy();
    expect(screen.getByText('Stripe needs a connection. Continue once you are back online.')).toBeTruthy();
  });

  it('Account › Payouts not set up (PA/Account-Payouts-NotSetUp)', async () => {
    api = mockApi({ getConnectStatus: 'error_not_found', createConnectAccount: 'connect_status_complete', createConnectOnboardingLink: LINK, getPublicConfig: config() });
    renderPayouts(scheme, 'account');
    await screen.findByText('Payouts are not set up');
    expect(screen.getByText('Stripe needs your bank details before it can pay you. Your earnings are still recorded.')).toBeTruthy();
    expect(screen.getByText('None yet')).toBeTruthy();
    expect(screen.getByText('Payouts off')).toBeTruthy();
    fireEvent.press(screen.getByText('Set up payouts with Stripe'));
    await waitFor(() => expect(openURL).toHaveBeenCalled());
  });

  it('Account › Payouts on: bank, schedule, change bank details opens a fresh link (PA/Account-Payouts)', async () => {
    api = mockApi({ getConnectStatus: connectOn(), createConnectOnboardingLink: LINK, getPublicConfig: config() });
    renderPayouts(scheme, 'account');
    await screen.findByText('ending 4821');
    expect(screen.getByText('Every Monday')).toBeTruthy();
    expect(screen.getByText('Payouts on')).toBeTruthy();
    expect(screen.getByText('Stripe holds your bank details. HalalGoes only sees the last 4 digits.')).toBeTruthy();
    fireEvent.press(screen.getByText('Change bank details with Stripe'));
    await waitFor(() => expect(openURL).toHaveBeenCalledWith('https://connect.stripe.com/setup/e/acct_1/abc'));
    expect(api.callsTo('createConnectAccount')).toHaveLength(0);
  });

  it('Account › Payouts with something needed later, from the real fixture (PA/Account-Payouts-Eventually)', async () => {
    api = mockApi({ getConnectStatus: 'connect_status_complete', getPublicConfig: config() });
    renderPayouts(scheme, 'account');
    await screen.findByText('Stripe will need 1 more thing later');
    expect(screen.getByText("Nothing to do yet. Payouts keep going. We'll tell you when Stripe needs it.")).toBeTruthy();
    expect(screen.getByText('Add it now with Stripe')).toBeTruthy();
    expect(screen.getByText('Copy details for support')).toBeTruthy();
  });

  it('Account › Payouts due by a deadline (PA/Account-Payouts-Due)', async () => {
    const deadline = '2026-10-30T16:00:00.000Z';
    api = mockApi({ getConnectStatus: connectWith({ currently_due: ['individual.verification.document'], deadline }, { payouts_enabled: true }), getPublicConfig: config() });
    renderPayouts(scheme, 'account');
    await screen.findByText(`Stripe needs 1 thing by ${longDate(deadline)}`);
    expect(screen.getByText('Payouts keep going until then.')).toBeTruthy();
    expect(screen.getByText('Continue to Stripe')).toBeTruthy();
  });

  it('Account › Payouts loading and error (PA/Account-Payouts-Loading, -Error)', async () => {
    api = mockApi({ getConnectStatus: (_c, nth) => (nth === 0 ? 'pending' : 'error_internal_error'), getPublicConfig: config() });
    renderPayouts(scheme, 'account');
    expect(screen.getByLabelText('Loading your payout status')).toBeTruthy();
    api.set('getConnectStatus', 'error_internal_error');
    returnToApp(); // foreground refetch
    await screen.findByText("We couldn't check your payouts");
    expect(screen.getByText('Your earnings are still recorded. Try again in a moment.')).toBeTruthy();
  });

  it('nothing sent from Payouts carries a price', async () => {
    api = mockApi({ getConnectStatus: 'error_not_found', createConnectAccount: 'connect_status_complete', createConnectOnboardingLink: LINK, getPublicConfig: config() });
    renderPayouts(scheme, 'application');
    fireEvent.press(await screen.findByText('Continue to Stripe'));
    await waitFor(() => expect(openURL).toHaveBeenCalled());
    for (const c of api.calls) expect(JSON.stringify(c.body ?? {})).not.toMatch(PRICE_KEYS);
  });
});
